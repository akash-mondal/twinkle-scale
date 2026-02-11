// Event emitter — structured events for frontend consumption.
// Every agent step emits an event. The frontend subscribes via callback or SSE.

import type { AgentEvent, AgentEventType, AgentEventHandler, BiteLayerResult } from './types.js';

export class AgentEventEmitter {
  private handler?: AgentEventHandler;
  private events: AgentEvent[] = [];

  onEvent(handler: AgentEventHandler) {
    this.handler = handler;
  }

  emit(
    type: AgentEventType,
    phase: string,
    data: Record<string, any>,
    biteLayer?: BiteLayerResult,
  ) {
    const event: AgentEvent = {
      type,
      timestamp: Date.now(),
      phase,
      data,
      biteLayer,
    };
    this.events.push(event);
    this.handler?.(event);
  }

  getAll(): AgentEvent[] {
    return [...this.events];
  }

  count(): number {
    return this.events.length;
  }
}
