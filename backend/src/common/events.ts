import { EventEmitter } from 'events';
import type { Response } from 'express';
import { logger } from './logger.js';

export type RealtimeEventType =
  | 'invoice.created'
  | 'payment.recorded'
  | 'subscription.status_changed'
  | 'invoice.overdue';

export interface RealtimeEventPayload {
  type: RealtimeEventType;
  data: Record<string, any>;
  timestamp: string;
}

class EventBus extends EventEmitter {
  private sseClients: Set<Response> = new Set();

  constructor() {
    super();
    this.setMaxListeners(200);
  }

  public registerClient(res: Response): void {
    this.sseClients.add(res);
    logger.debug({ totalClients: this.sseClients.size }, 'New SSE client connected');

    res.on('close', () => {
      this.sseClients.delete(res);
      logger.debug({ totalClients: this.sseClients.size }, 'SSE client disconnected');
    });
  }

  public broadcast(type: RealtimeEventType, data: Record<string, any>): void {
    const payload: RealtimeEventPayload = {
      type,
      data,
      timestamp: new Date().toISOString()
    };

    // Emit internally for jobs or event listeners
    this.emit(type, payload);

    // Format for SSE: event: <type>\ndata: <json>\n\n
    const message = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of this.sseClients) {
      try {
        client.write(message);
      } catch (err) {
        logger.error({ err }, 'Failed to write SSE message to client');
        this.sseClients.delete(client);
      }
    }
  }

  public getClientCount(): number {
    return this.sseClients.size;
  }
}

export const eventBus = new EventBus();
