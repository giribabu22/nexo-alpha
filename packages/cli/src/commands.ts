import type { NexoApplication } from "@nexo-alpha/core";
import { buildContext, contextToJson } from "@nexo-alpha/context";
import {
  renderApplicationSummary,
  renderDevelopmentState,
  renderModuleDetail
} from "./render.js";

export function inspect(app: NexoApplication, moduleName?: string): string {
  const context = buildContext(app);

  if (moduleName === undefined) {
    return renderApplicationSummary(context);
  }

  const module = context.modules.find((m) => m.name === moduleName);

  if (module === undefined) {
    const known = context.modules.map((m) => m.name);
    const suggestion =
      known.length > 0
        ? ` Did you mean one of: ${known.join(", ")}?`
        : " This application has no registered modules.";
    throw new Error(`No module named "${moduleName}" found.${suggestion}`);
  }

  return renderModuleDetail(module);
}

export function status(app: NexoApplication): string {
  return renderDevelopmentState(app.getDevelopmentState());
}

export function context(app: NexoApplication): string {
  return contextToJson(buildContext(app));
}
