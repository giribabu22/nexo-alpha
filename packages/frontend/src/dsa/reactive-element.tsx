import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from "react";
import { NexoElementGraph, type ElementNode } from "./graph.js";

const ElementGraphContext = createContext<NexoElementGraph | null>(null);
const ParentElementIdContext = createContext<string | null>(null);

let globalGraph: NexoElementGraph | undefined;

export function getGlobalElementGraph(): NexoElementGraph {
  if (!globalGraph) {
    globalGraph = new NexoElementGraph();
  }
  return globalGraph;
}

export interface NexoElementRootProps {
  readonly graph?: NexoElementGraph | undefined;
  readonly children: ReactNode;
}

export function NexoElementRoot({ graph, children }: NexoElementRootProps): React.JSX.Element {
  const resolvedGraph = graph ?? getGlobalElementGraph();
  return (
    <ElementGraphContext.Provider value={resolvedGraph}>
      {children}
    </ElementGraphContext.Provider>
  );
}

export interface NexoElementProps {
  readonly id: string;
  readonly name?: string | undefined;
  readonly data?: unknown | undefined;
  readonly children: ReactNode | ((node: ElementNode | undefined) => ReactNode);
}

export function NexoElement({
  id,
  name = id,
  data,
  children
}: NexoElementProps): React.JSX.Element {
  const graph = useContext(ElementGraphContext) ?? getGlobalElementGraph();
  const parentId = useContext(ParentElementIdContext);
  const [, setTick] = useState(0);
  const prevDataRef = useRef<unknown>(data);

  useEffect(() => {
    // Register node in DAG
    const depth = parentId ? (graph.getNode(parentId)?.depth ?? 0) + 1 : 0;
    graph.addNode(id, name, depth, data);

    if (parentId) {
      graph.addEdge(parentId, id);
    }

    return () => {
      graph.removeNode(id);
    };
  }, [graph, id, name, parentId]);

  // Check if data changed to mark node and descendants dirty
  if (prevDataRef.current !== data) {
    prevDataRef.current = data;
    graph.markDirty(id, true);
  }

  const node = graph.getNode(id);

  return (
    <ParentElementIdContext.Provider value={id}>
      {typeof children === "function" ? children(node) : children}
    </ParentElementIdContext.Provider>
  );
}

export function useNexoElementGraph(): NexoElementGraph {
  return useContext(ElementGraphContext) ?? getGlobalElementGraph();
}
