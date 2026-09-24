import type { NexoApplication } from "./application.js";

export type LifecyclePhase =
  | "beforeInit"
  | "afterInit"
  | "beforeStart"
  | "afterStart"
  | "beforeStop"
  | "afterStop";

export type LifecycleHook = (
  app: NexoApplication
) => Promise<void> | void;

export class LifecycleRegistry {
  private readonly hooks = new Map<LifecyclePhase, LifecycleHook[]>();

  constructor() {
    this.hooks.set("beforeInit", []);
    this.hooks.set("afterInit", []);
    this.hooks.set("beforeStart", []);
    this.hooks.set("afterStart", []);
    this.hooks.set("beforeStop", []);
    this.hooks.set("afterStop", []);
  }

  add(phase: LifecyclePhase, hook: LifecycleHook): this {
    const list = this.hooks.get(phase);
    if (list) {
      list.push(hook);
    }
    return this;
  }

  async run(phase: LifecyclePhase, app: NexoApplication): Promise<void> {
    const list = this.hooks.get(phase) ?? [];
    for (const hook of list) {
      await hook(app);
    }
  }

  getHooks(phase: LifecyclePhase): readonly LifecycleHook[] {
    return [...(this.hooks.get(phase) ?? [])];
  }
}
