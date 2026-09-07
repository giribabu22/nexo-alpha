import type { ApplicationContext, DevelopmentState, ModuleContext } from "@nexo-alpha/context";


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

export function renderValidation(archIssues: readonly { severity: string; message: string; target?: string }[], configIssues: readonly { severity: string; message: string; target?: string }[]): string {
  const all = [...archIssues, ...configIssues];
  if (all.length === 0) {
    return "Nexo Validation: PASSED (0 issues)";
  }

  const errors = all.filter((i) => i.severity === "error");
  const warnings = all.filter((i) => i.severity === "warning");

  const lines = [
    `Nexo Validation: ${errors.length === 0 ? "PASSED WITH WARNINGS" : "FAILED"} (${errors.length} errors, ${warnings.length} warnings)`,
    ""
  ];

  for (const issue of all) {
    lines.push(`[${issue.severity.toUpperCase()}] ${issue.message}`);
  }

  return lines.join("\n");
}

export function renderHealth(health: {
  state: string;
  moduleCount: number;
  apiCount: number;
  serviceCount: number;
  architecture: { valid: boolean; issues: readonly { severity: string; message: string }[] };
}): string {
  const lines = [
    "Nexo Application Health",
    "",
    `State: ${health.state}`,
    `Modules: ${health.moduleCount}`,
    `APIs: ${health.apiCount}`,
    `Services: ${health.serviceCount}`,
    `Architecture Valid: ${health.architecture.valid ? "YES" : "NO"} (${health.architecture.issues.length} issues)`
  ];

  return lines.join("\n");
}
