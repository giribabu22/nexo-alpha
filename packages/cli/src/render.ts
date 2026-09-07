import type { DevelopmentState } from "@nexo-alpha/core";
import type { ApplicationContext, ModuleContext } from "@nexo-alpha/context";

function renderList(items: readonly string[]): string {
  return items.length > 0
    ? items.map((item) => `  ${item}`).join("\n")
    : "  (none)";
}

export function renderApplicationSummary(context: ApplicationContext): string {
  const { application, modules } = context;
  const lines = [
    "Nexo Application",
    "",
    `Name: ${application.name}`,
    `Version: ${application.version}`
  ];

  if (application.description !== undefined) {
    lines.push(`Description: ${application.description}`);
  }

  lines.push(`State: ${application.state}`, "", "Modules:");
  lines.push(renderList(modules.map((module) => module.name)));

  return lines.join("\n");
}

export function renderModuleDetail(module: ModuleContext): string {
  const lines = [module.name, ""];

  if (module.purpose !== undefined) {
    lines.push(`Purpose: ${module.purpose}`);
  }
  if (module.description !== undefined) {
    lines.push(`Description: ${module.description}`);
  }
  if (module.status !== undefined) {
    lines.push(`Status: ${module.status}`);
  }

  lines.push(
    "",
    "Dependencies:",
    renderList(module.dependencies),
    "",
    "Dependents:",
    renderList(module.dependents),
    "",
    "APIs:",
    renderList(module.apis.map((api) => `${api.method} ${api.path}  ${api.name}`)),
    "",
    "Services:",
    renderList(module.services.map((service) => service.name)),
    "",
    "Events:",
    renderList(module.events),
    "",
    "Jobs:",
    renderList(
      module.jobs.map((job) =>
        job.schedule !== undefined ? `${job.name}  (${job.schedule})` : job.name
      )
    )
  );

  return lines.join("\n");
}

export function renderDevelopmentState(state: DevelopmentState): string {
  const lines = ["Nexo Development Status", ""];

  lines.push(
    "Current objective:",
    state.currentObjective !== undefined ? `  ${state.currentObjective}` : "  (none)",
    "",
    "Completed:",
    renderList(state.completed),
    "",
    "In progress:",
    renderList(state.inProgress),
    "",
    "Blocked:",
    renderList(state.blocked),
    "",
    "Known issues:",
    renderList(state.knownIssues),
    "",
    "Next step:",
    state.nextStep !== undefined ? `  ${state.nextStep}` : "  (none)"
  );

  return lines.join("\n");
}
