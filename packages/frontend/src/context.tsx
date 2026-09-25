import React, { createContext, useContext, useMemo, type ReactNode } from "react";
import { NexoClient, createNexoClient } from "./client.js";
import type { NexoClientOptions } from "./types.js";

interface NexoContextValue {
  readonly client: NexoClient;
}

const NexoContext = createContext<NexoContextValue | null>(null);

let defaultGlobalClient: NexoClient | undefined;

function getDefaultClient(): NexoClient {
  if (!defaultGlobalClient) {
    defaultGlobalClient = createNexoClient();
  }
  return defaultGlobalClient;
}

export interface NexoProviderProps extends NexoClientOptions {
  readonly client?: NexoClient | undefined;
  readonly children: ReactNode;
}

export function NexoProvider({
  client,
  baseUrl,
  headers,
  fetch: customFetch,
  workflowsPath,
  memoryPath,
  projectId,
  projectsPath,
  children
}: NexoProviderProps): React.JSX.Element {
  const resolvedClient = useMemo(() => {
    if (client) {
      return projectId !== undefined ? client.forProject(projectId) : client;
    }
    return createNexoClient({ baseUrl, headers, fetch: customFetch, workflowsPath, memoryPath, projectId, projectsPath });
  }, [client, baseUrl, headers, customFetch, workflowsPath, memoryPath, projectId, projectsPath]);

  return (
    <NexoContext.Provider value={{ client: resolvedClient }}>
      {children}
    </NexoContext.Provider>
  );
}

export function useNexoClient(): NexoClient {
  const context = useContext(NexoContext);
  if (!context) {
    return getDefaultClient();
  }
  return context.client;
}
