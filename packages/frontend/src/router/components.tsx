import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useMemo,
  type ReactNode,
  type MouseEvent
} from "react";
import { NexoRouter, createNexoRouter, type MatchedRoute } from "./router.js";

interface RouterContextValue {
  readonly router: NexoRouter<ReactNode>;
  readonly currentMatch: MatchedRoute<ReactNode> | null;
  readonly path: string;
  readonly navigate: (to: string) => void;
}

const RouterContext = createContext<RouterContextValue | null>(null);

export interface NexoRouterProviderProps {
  readonly router?: NexoRouter<ReactNode> | undefined;
  readonly initialPath?: string | undefined;
  readonly children: ReactNode;
}

export function NexoRouterProvider({
  router: propRouter,
  initialPath,
  children
}: NexoRouterProviderProps): React.JSX.Element {
  const router = useMemo(() => propRouter ?? createNexoRouter<ReactNode>(), [propRouter]);
  const [currentPath, setCurrentPath] = useState<string>(() => {
    if (initialPath) return initialPath;
    if (typeof window !== "undefined" && window.location) {
      return window.location.pathname;
    }
    return "/";
  });

  const [currentMatch, setCurrentMatch] = useState<MatchedRoute<ReactNode> | null>(() =>
    router.match(currentPath)
  );

  const navigate = useMemo(() => {
    return (to: string) => {
      if (typeof window !== "undefined" && window.history) {
        window.history.pushState({}, "", to);
      }
      setCurrentPath(to);
      const match = router.match(to);
      setCurrentMatch(match);
      router.navigate(to);
    };
  }, [router]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handlePopState = () => {
      const path = window.location.pathname;
      setCurrentPath(path);
      setCurrentMatch(router.match(path));
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [router]);

  return (
    <RouterContext.Provider value={{ router, currentMatch, path: currentPath, navigate }}>
      {children}
    </RouterContext.Provider>
  );
}

export interface NexoRouteProps {
  readonly path: string;
  readonly element: ReactNode;
}

export function NexoRoute(_props: NexoRouteProps): null {
  return null;
}

export function NexoRoutes({ children }: { readonly children: ReactNode }): React.JSX.Element | null {
  const context = useContext(RouterContext);
  if (!context) {
    throw new Error("NexoRoutes must be used within a NexoRouterProvider");
  }

  // Register child routes into the trie on mount/change
  useMemo(() => {
    React.Children.forEach(children, (child) => {
      if (React.isValidElement<NexoRouteProps>(child) && child.props.path && child.props.element) {
        context.router.register(child.props.path, child.props.element);
      }
    });
  }, [children, context.router]);

  const match = context.router.match(context.path);
  if (!match) {
    return null;
  }

  return <>{match.component}</>;
}

export interface NexoLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  readonly to: string;
  readonly children: ReactNode;
}

export function NexoLink({ to, onClick, children, ...rest }: NexoLinkProps): React.JSX.Element {
  const context = useContext(RouterContext);

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (onClick) onClick(e);
    if (!e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      if (context) {
        context.navigate(to);
      }
    }
  };

  return (
    <a href={to} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}

export function useNexoRoute(): MatchedRoute<ReactNode> | null {
  const context = useContext(RouterContext);
  return context?.currentMatch ?? null;
}

export function useNexoParams(): Readonly<Record<string, string>> {
  const context = useContext(RouterContext);
  return context?.currentMatch?.params ?? {};
}

export function useNexoNavigate(): (to: string) => void {
  const context = useContext(RouterContext);
  if (!context) {
    return (to: string) => {
      if (typeof window !== "undefined") {
        window.location.href = to;
      }
    };
  }
  return context.navigate;
}
