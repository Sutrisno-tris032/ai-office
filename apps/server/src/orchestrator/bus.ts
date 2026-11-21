import { EventEmitter } from 'node:events';
import type { ServerEvent } from '@ai-office/shared';

/** Pub/sub event realtime per proyek. Untuk skala multi-instance, ganti dengan Redis pub/sub. */
export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(1000);
  }

  publish(projectId: string, event: ServerEvent): void {
    this.emitter.emit(projectId, event);
  }

  subscribe(projectId: string, fn: (e: ServerEvent) => void): () => void {
    this.emitter.on(projectId, fn);
    return () => this.emitter.off(projectId, fn);
  }
}
