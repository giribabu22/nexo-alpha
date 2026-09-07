import { EventEmitter } from "node:events";

export class NexoEventBus {
  private readonly emitter = new EventEmitter();

  on(event: string, listener: (...args: unknown[]) => void): this {
    this.emitter.on(event, listener);
    return this;
  }

  off(event: string, listener: (...args: unknown[]) => void): this {
    this.emitter.off(event, listener);
    return this;
  }

  emit(event: string, ...args: unknown[]): boolean {
    return this.emitter.emit(event, ...args);
  }
}
