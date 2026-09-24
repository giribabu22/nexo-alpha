export type NexoMiddleware<TContext = unknown, TResult = unknown> = (
  context: TContext,
  next: () => Promise<TResult>
) => Promise<TResult> | TResult;

export class NexoMiddlewarePipeline<TContext = unknown, TResult = unknown> {
  private readonly middlewares: NexoMiddleware<TContext, TResult>[] = [];

  use(...middlewares: NexoMiddleware<TContext, TResult>[]): this {
    this.middlewares.push(...middlewares);
    return this;
  }

  get length(): number {
    return this.middlewares.length;
  }

  getMiddlewares(): readonly NexoMiddleware<TContext, TResult>[] {
    return [...this.middlewares];
  }

  async execute(
    context: TContext,
    target: (context: TContext) => Promise<TResult> | TResult
  ): Promise<TResult> {
    let index = -1;

    const dispatch = async (i: number): Promise<TResult> => {
      if (i <= index) {
        throw new Error("next() called multiple times in middleware pipeline");
      }
      index = i;

      if (i < this.middlewares.length) {
        const fn = this.middlewares[i];
        if (fn) {
          return await fn(context, () => dispatch(i + 1));
        }
      }

      return await target(context);
    };

    return await dispatch(0);
  }
}
