import React, {
  forwardRef,
  memo as reactMemo,
  type ReactNode,
  type CSSProperties
} from "react";
import { NexoElement } from "../dsa/reactive-element.js";
import { NexoLruCache } from "../dsa/lru.js";

export interface NexoCompMetadata {
  /** The registered name of this nexoComp */
  readonly name: string;
  /** Optional architectural purpose or intent */
  readonly purpose?: string | undefined;
  /** Direct upstream nexoComp or module dependencies */
  readonly dependencies?: readonly string[] | undefined;
  /** Optional source code evidence */
  readonly evidence?: {
    readonly file?: string | undefined;
    readonly line?: number | undefined;
  } | undefined;
}

export interface NexoCompDsaConfig<TProps = any> {
  /** Whether to register node in NexoElementGraph DAG tree for dirty state tracking */
  readonly trackDirty?: boolean | undefined;
  /** Whether to enable O(1) LRU render memoization cache */
  readonly lruCache?: boolean | undefined;
  /** Custom key generator when lruCache is enabled */
  readonly cacheKey?: ((props: TProps) => string) | undefined;
}

export interface NexoCompOptions<TProps = any> extends NexoCompMetadata {
  /** Whether to wrap component in React.memo (default: true) */
  readonly memo?: boolean | undefined;
  /** DSA optimization configurations */
  readonly dsa?: NexoCompDsaConfig<TProps> | undefined;
  /** Underlying render function executed by React in the background */
  render(props: TProps, ref?: any): ReactNode;
}

/**
 * NexoComp is the foundational UI building block in Nexo.
 * React powers the rendering, hooks, and virtual DOM in the background,
 * while NexoComp provides DAG state-graph tracking, LRU memoization, and introspection.
 */
export type NexoComp<TProps = any> = React.ForwardRefExoticComponent<
  React.PropsWithoutRef<TProps> & React.RefAttributes<any>
> & {
  readonly compName: string;
  readonly purpose?: string | undefined;
  readonly dependencies?: readonly string[] | undefined;
  readonly isNexoComp: true;
  readonly dsa?: NexoCompDsaConfig<TProps> | undefined;
  withProps(defaultProps: Partial<TProps>): NexoComp<TProps>;
};

// Global LRU cache for nexoComp memoization if enabled
const compLruCache = new NexoLruCache<string, ReactNode>(500);

/**
 * Define and register a NexoComp.
 * React handles rendering in the background while Nexo provides DSA optimization.
 */
export function nexoComp<TProps extends Record<string, any> = Record<string, any>>(
  optionsOrName: NexoCompOptions<TProps> | string | ((props: TProps, ref?: any) => ReactNode),
  maybeRender?: ((props: TProps, ref?: any) => ReactNode) | Omit<NexoCompOptions<TProps>, "name" | "render">,
  maybeOptions?: Omit<NexoCompOptions<TProps>, "name" | "render">
): NexoComp<TProps> {
  let normalizedOptions: NexoCompOptions<TProps>;

  if (typeof optionsOrName === "string") {
    const renderFn = typeof maybeRender === "function" ? maybeRender : () => null;
    const extraOpts = (typeof maybeRender === "object" ? maybeRender : maybeOptions) ?? {};
    normalizedOptions = {
      name: optionsOrName,
      render: renderFn,
      ...extraOpts
    };
  } else if (typeof optionsOrName === "function") {
    const extraOpts = (typeof maybeRender === "object" ? maybeRender : {}) as Omit<NexoCompOptions<TProps>, "name" | "render">;
    normalizedOptions = {
      name: optionsOrName.name || "AnonymousNexoComp",
      render: optionsOrName,
      ...extraOpts
    };
  } else {
    normalizedOptions = optionsOrName;
  }

  const {
    name,
    purpose,
    dependencies,
    memo = true,
    dsa = { trackDirty: true, lruCache: false },
    render
  } = normalizedOptions;

  const BaseNexoComp = (props: TProps, ref: any): ReactNode => {
    // Check LRU cache if configured
    if (dsa.lruCache && dsa.cacheKey) {
      const key = `${name}:${dsa.cacheKey(props)}`;
      const cached = compLruCache.get(key);
      if (cached !== undefined) {
        return cached;
      }
      const rendered = render(props, ref);
      compLruCache.set(key, rendered);
      return rendered;
    }

    // Wrap with DAG element tracking if enabled
    if (dsa.trackDirty) {
      const elementId = (props as any)?.id ?? `nexo-comp-${name}`;
      return (
        <NexoElement id={elementId} name={name} data={props}>
          {render(props, ref)}
        </NexoElement>
      );
    }

    return render(props, ref);
  };

  const Forwarded = forwardRef<any, any>(BaseNexoComp as any);
  const FinalComp = (memo ? reactMemo(Forwarded) : Forwarded) as unknown as NexoComp<TProps>;

  Object.defineProperties(FinalComp, {
    compName: { value: name, writable: false },
    purpose: { value: purpose, writable: false },
    dependencies: { value: dependencies ?? [], writable: false },
    isNexoComp: { value: true, writable: false },
    dsa: { value: dsa, writable: false },
    withProps: {
      value: (defaultProps: Partial<TProps>) => {
        return nexoComp<TProps>({
          name: `${name}.preset`,
          purpose: `Preset variation of ${name}`,
          dependencies,
          memo,
          dsa,
          render: (props: TProps, ref: any) => {
            return render({ ...defaultProps, ...props }, ref);
          }
        });
      },
      writable: false
    }
  });

  FinalComp.displayName = `NexoComp(${name})`;
  return FinalComp;
}

export const defineNexoComp = nexoComp;
