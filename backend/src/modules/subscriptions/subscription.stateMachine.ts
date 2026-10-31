import { UnprocessableEntityError } from '../../common/errors.js';

export type SubStatus = 'draft' | 'quotation' | 'confirmed' | 'active' | 'closed';

export const ALLOWED_SUBSCRIPTION_TRANSITIONS: Record<SubStatus, SubStatus[]> = {
  draft: ['quotation', 'closed'],
  quotation: ['confirmed', 'closed'],
  confirmed: ['active', 'closed'],
  active: ['closed'],
  closed: [] // closed is terminal
};

export function assertSubscriptionTransition(from: SubStatus, to: SubStatus): void {
  if (from === to) {
    return; // No-op transition
  }

  const allowed = ALLOWED_SUBSCRIPTION_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new UnprocessableEntityError(
      `Illegal subscription state transition from '${from}' to '${to}'. Allowed transitions from '${from}': [${(allowed || []).join(', ')}]`
    );
  }
}
