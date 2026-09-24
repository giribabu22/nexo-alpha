import { NexoResolutionError } from "./errors.js";

export type Constructor<T = unknown> = new (...args: any[]) => T;
export type AbstractConstructor<T = unknown> = abstract new (...args: any[]) => T;

export type ServiceToken<T = unknown> =
  | string
  | symbol
  | Constructor<T>
  | AbstractConstructor<T>;

export type ServiceLifetime = "singleton" | "transient" | "scoped";

export type ServiceFactory<T = unknown> = (container: NexoContainer) => T;

export interface BindOptions {
  readonly lifetime?: ServiceLifetime;
  readonly singleton?: boolean;
}

interface ServiceBinding<T = unknown> {
  readonly token: ServiceToken<T>;
  readonly factory: ServiceFactory<T>;
  readonly lifetime: ServiceLifetime;
  instance?: T;
}

function tokenToString(token: ServiceToken<unknown>): string {
  if (typeof token === "string") {
    return token;
  }
  if (typeof token === "symbol") {
    return token.description ? `Symbol(${token.description})` : token.toString();
  }
  if (typeof token === "function" && token.name) {
    return token.name;
  }
  return String(token);
}

export class NexoContainer {
  private readonly bindings = new Map<ServiceToken<unknown>, ServiceBinding<any>>();
  private readonly scopedInstances = new Map<ServiceToken<unknown>, unknown>();
  private readonly parent: NexoContainer | undefined;
  private readonly resolvingStack: ServiceToken<unknown>[] = [];

  constructor(parent?: NexoContainer) {
    this.parent = parent;
  }

  bind<T>(
    token: ServiceToken<T>,
    factory: ServiceFactory<T>,
    options?: BindOptions
  ): this {
    let lifetime: ServiceLifetime = "transient";
    if (options?.lifetime) {
      lifetime = options.lifetime;
    } else if (options?.singleton) {
      lifetime = "singleton";
    }

    this.bindings.set(token, {
      token,
      factory,
      lifetime
    });

    return this;
  }

  bindValue<T>(token: ServiceToken<T>, value: T): this {
    this.bindings.set(token, {
      token,
      factory: () => value,
      lifetime: "singleton",
      instance: value
    });

    return this;
  }

  bindClass<T>(
    token: ServiceToken<T>,
    ctor: Constructor<T>,
    options?: BindOptions
  ): this {
    return this.bind(token, () => new ctor(), options);
  }

  has(token: ServiceToken<unknown>): boolean {
    if (this.bindings.has(token)) {
      return true;
    }
    return this.parent?.has(token) ?? false;
  }

  resolve<T>(token: ServiceToken<T>): T {
    const tokenName = tokenToString(token);

    if (this.resolvingStack.includes(token)) {
      const cycle = [...this.resolvingStack.map(tokenToString), tokenName].join(" -> ");
      throw new NexoResolutionError(`Circular dependency detected: ${cycle}`);
    }

    const binding = this.findBinding(token);
    if (!binding) {
      throw new NexoResolutionError(
        `No service binding found for token "${tokenName}".`
      );
    }

    if (binding.lifetime === "singleton") {
      if (binding.instance === undefined) {
        this.resolvingStack.push(token);
        try {
          binding.instance = binding.factory(this);
        } finally {
          this.resolvingStack.pop();
        }
      }
      return binding.instance as T;
    }

    if (binding.lifetime === "scoped") {
      if (!this.scopedInstances.has(token)) {
        this.resolvingStack.push(token);
        try {
          const instance = binding.factory(this);
          this.scopedInstances.set(token, instance);
        } finally {
          this.resolvingStack.pop();
        }
      }
      return this.scopedInstances.get(token) as T;
    }

    // Transient
    this.resolvingStack.push(token);
    try {
      return binding.factory(this) as T;
    } finally {
      this.resolvingStack.pop();
    }
  }

  createChild(): NexoContainer {
    return new NexoContainer(this);
  }

  private findBinding<T>(token: ServiceToken<T>): ServiceBinding<T> | undefined {
    if (this.bindings.has(token)) {
      return this.bindings.get(token) as ServiceBinding<T>;
    }
    return this.parent?.findBinding(token);
  }
}
