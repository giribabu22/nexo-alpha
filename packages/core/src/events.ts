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

export const NexoEvent = {
  API_CALLED: "api.called",
  API_ERROR: "api.error",
  JOB_RAN: "job.ran",
  JOB_FAILED: "job.failed"
} as const;

export interface ApiCalledEvent {
  readonly api: string;
  readonly method: string;
  readonly path: string;
  readonly statusCode: number;
  readonly durationMs: number;
}

export interface ApiErrorEvent {
  readonly api: string;
  readonly method: string;
  readonly path: string;
  readonly durationMs: number;
  readonly error: string;
}

export interface JobRanEvent {
  readonly job: string;
  readonly durationMs: number;
}

export interface JobFailedEvent {
  readonly job: string;
  readonly durationMs: number;
  readonly error: string;
}
