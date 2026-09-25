import { Template } from "./types.js";
import { fullstackReactTemplate } from "./fullstack-react.js";
import { backendApiTemplate } from "./backend-api.js";
import { minimalTemplate } from "./minimal.js";
import { agentServiceTemplate } from "./agent-service.js";

export * from "./types.js";

export const templates: Record<string, Template> = {
  "fullstack-react": fullstackReactTemplate,
  "backend-api": backendApiTemplate,
  backend: backendApiTemplate,
  minimal: minimalTemplate,
  "agent-service": agentServiceTemplate
};

export const defaultTemplateName = "fullstack-react";
