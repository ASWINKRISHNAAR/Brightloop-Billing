import { withTransaction } from '../../db/pool.js';
import { subscriptionRepository, SubscriptionRow } from './subscription.repository.js';
import {
  CreateSubscriptionInput,
  PauseSubscriptionInput,
  RenewSubscriptionInput
} from './subscription.schema.js';
import { SubStatus, assertSubscriptionTransition } from './subscription.stateMachine.js';
import { plansRepository } from '../plans/plans.repository.js';
import { catalogRepository } from '../catalog/catalog.repository.js';
import { templatesRepository } from '../templates/templates.repository.js';
import { authRepository } from '../auth/auth.repository.js';
import {
  NotFoundError,
  ValidationError,
  ForbiddenError
} from '../../common/errors.js';
import { eventBus } from '../../common/events.js';

export class SubscriptionService {
  async createSubscription(input: CreateSubscriptionInput, userId: string): Promise<SubscriptionRow> {
    const plan = await plansRepository.findPlanById(input.planId);
    if (!plan) {
      throw new NotFoundError('Plan not found');
    }

    if (!plan.is_active) {
      throw new ValidationError('Cannot create subscription on an inactive plan');
    }

    // Check plan availability window
    const startDate = new Date(input.startDate);
    if (plan.available_from && startDate < new Date(plan.available_from)) {
      throw new ValidationError(`Plan is not available until ${plan.available_from}`);
    }
    if (plan.available_to && startDate > new Date(plan.available_to)) {
      throw new ValidationError(`Plan availability ended on ${plan.available_to}`);
    }

    // Prepare line items
    let linesToInsert: Array<{ productId: string; variantId?: string | null; unitPrice: number; quantity: number }> = [];

    // If template specified, copy lines from template
    if (input.templateId) {
      const template = await templatesRepository.findTemplateById(input.templateId);
      if (!template || !template.is_active) {
        throw new NotFoundError('Quotation template not found or inactive');
      }

      if (template.lines && template.lines.length > 0) {
        for (const line of template.lines) {
          const product = await catalogRepository.findProductById(line.product_id);
          if (!product) continue;

          let unitPrice = Number(product.base_price);
          if (line.variant_id) {
            const variant = await catalogRepository.findVariantById(line.variant_id);
            if (variant) {
              unitPrice += Number(variant.extra_price);
            }
          }

          linesToInsert.push({
            productId: line.product_id,
            variantId: line.variant_id,
            unitPrice,
            quantity: line.quantity
          });
        }
      }
    } else if (input.lines && input.lines.length > 0) {
      for (const line of input.lines) {
        let unitPrice = line.unitPrice;
        if (unitPrice === undefined) {
          const product = await catalogRepository.findProductById(line.productId);
          if (!product) {
            throw new NotFoundError(`Product ${line.productId} not found`);
          }
          unitPrice = Number(product.base_price);
          if (line.variantId) {
            const variant = await catalogRepository.findVariantById(line.variantId);
            if (variant) {
              unitPrice += Number(variant.extra_price);
            }
          }
        }

        linesToInsert.push({
          productId: line.productId,
          variantId: line.variantId ?? null,
          unitPrice,
          quantity: line.quantity
        });
      }
    }

    // Verify minimum quantity constraint from plan
    const totalQuantity = linesToInsert.reduce((sum, l) => sum + l.quantity, 0);
    if (totalQuantity < plan.min_quantity) {
      throw new ValidationError(
        `Total quantity (${totalQuantity}) is below the required plan minimum of ${plan.min_quantity}`
      );
    }

    return withTransaction(async (client) => {
      const sub = await subscriptionRepository.createSubscription(
        {
          customerId: input.customerId,
          planId: input.planId,
          startDate: input.startDate,
          expiryDate: input.expiryDate,
          notes: input.notes,
          lines: linesToInsert
        },
        client
      );

      await authRepository.writeAuditLog(
        {
          userId,
          action: 'subscription.created',
          entity: 'subscriptions',
          entityId: sub.id,
          afterState: { ...sub, linesCount: linesToInsert.length }
        },
        client
      );

      return (await subscriptionRepository.findSubscriptionById(sub.id, client))!;
    });
  }

  async transitionStatus(
    id: string,
    targetStatus: SubStatus,
    userId: string
  ): Promise<SubscriptionRow> {
    const sub = await subscriptionRepository.findSubscriptionById(id);
    if (!sub) {
      throw new NotFoundError('Subscription not found');
    }

    // 1. Verify legal transition in state machine
    assertSubscriptionTransition(sub.status, targetStatus);

    // 2. Check plan constraints
    if (targetStatus === 'closed' && sub.status !== 'draft') {
      if (sub.plan_closable === false) {
        throw new ForbiddenError('Plan is configured as non-closable early.');
      }
    }

    let nextBillingDate: string | null | undefined = undefined;

    // Transition side effects
    if (targetStatus === 'active') {
      // confirmed -> active sets next_billing_date = start_date
      nextBillingDate = sub.start_date;
    } else if (targetStatus === 'closed') {
      // active -> closed stops billing
      nextBillingDate = null;
    }

    return withTransaction(async (client) => {
      const updated = await subscriptionRepository.updateSubscriptionStatus(
        id,
        sub.version,
        {
          status: targetStatus,
          nextBillingDate
        },
        client
      );

      await authRepository.writeAuditLog(
        {
          userId,
          action: 'subscription.status_changed',
          entity: 'subscriptions',
          entityId: id,
          beforeState: { status: sub.status, nextBillingDate: sub.next_billing_date },
          afterState: { status: targetStatus, nextBillingDate: updated.next_billing_date }
        },
        client
      );

      // Emit real-time SSE event
      eventBus.broadcast('subscription.status_changed', {
        subscriptionId: id,
        subscriptionNumber: sub.subscription_number,
        previousStatus: sub.status,
        newStatus: targetStatus,
        customerId: sub.customer_id
      });

      return (await subscriptionRepository.findSubscriptionById(id, client))!;
    });
  }

  async pauseSubscription(id: string, input: PauseSubscriptionInput, userId: string): Promise<SubscriptionRow> {
    const sub = await subscriptionRepository.findSubscriptionById(id);
    if (!sub) {
      throw new NotFoundError('Subscription not found');
    }

    if (sub.status !== 'active') {
      throw new ValidationError(`Only active subscriptions can be paused. Current status is '${sub.status}'`);
    }

    if (sub.plan_pausable === false) {
      throw new ForbiddenError('Plan is configured as non-pausable.');
    }

    return withTransaction(async (client) => {
      await subscriptionRepository.updateSubscriptionStatus(
        id,
        sub.version,
        {
          status: 'active',
          pausedUntil: input.pausedUntil
        },
        client
      );

      await authRepository.writeAuditLog(
        {
          userId,
          action: 'subscription.paused',
          entity: 'subscriptions',
          entityId: id,
          afterState: { pausedUntil: input.pausedUntil }
        },
        client
      );

      return (await subscriptionRepository.findSubscriptionById(id, client))!;
    });
  }

  async resumeSubscription(id: string, userId: string): Promise<SubscriptionRow> {
    const sub = await subscriptionRepository.findSubscriptionById(id);
    if (!sub) {
      throw new NotFoundError('Subscription not found');
    }

    return withTransaction(async (client) => {
      await subscriptionRepository.updateSubscriptionStatus(
        id,
        sub.version,
        {
          status: 'active',
          pausedUntil: null
        },
        client
      );

      await authRepository.writeAuditLog(
        {
          userId,
          action: 'subscription.resumed',
          entity: 'subscriptions',
          entityId: id
        },
        client
      );

      return (await subscriptionRepository.findSubscriptionById(id, client))!;
    });
  }

  async renewSubscription(id: string, input: RenewSubscriptionInput, userId: string): Promise<SubscriptionRow> {
    const sub = await subscriptionRepository.findSubscriptionById(id);
    if (!sub) {
      throw new NotFoundError('Subscription not found');
    }

    if (sub.plan_renewable === false) {
      throw new ForbiddenError('Plan is configured as non-renewable.');
    }

    return withTransaction(async (client) => {
      await subscriptionRepository.updateSubscription(
        id,
        sub.version,
        {
          expiryDate: input.newExpiryDate
        },
        client
      );

      await authRepository.writeAuditLog(
        {
          userId,
          action: 'subscription.renewed',
          entity: 'subscriptions',
          entityId: id,
          afterState: { expiryDate: input.newExpiryDate }
        },
        client
      );

      return (await subscriptionRepository.findSubscriptionById(id, client))!;
    });
  }

  async autoCloseExpiredSubscriptions(): Promise<number> {
    const expiredList = await subscriptionRepository.listExpiredSubscriptionsForAutoClose();
    let closedCount = 0;

    for (const sub of expiredList) {
      try {
        await this.transitionStatus(sub.id, 'closed', 'system-auto-close-job');
        closedCount++;
      } catch (err) {
        // Individual failure does not halt others
        console.error(`Failed to auto-close subscription ${sub.id}:`, err);
      }
    }

    return closedCount;
  }
}

export const subscriptionService = new SubscriptionService();
