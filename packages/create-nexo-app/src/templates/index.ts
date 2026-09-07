import { Template } from "./types.js";
import { fullstackReactTemplate } from "./fullstack-react.js";
import { backendApiTemplate } from "./backend-api.js";
import { minimalTemplate } from "./minimal.js";

export * from "./types.js";

export const templates: Record<string, Template> = {
  "fullstack-react": fullstackReactTemplate,
  "backend-api": backendApiTemplate,
  backend: backendApiTemplate,
  minimal: minimalTemplate
};

export const defaultTemplateName = "fullstack-react";
