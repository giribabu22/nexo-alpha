import { promises as fs } from "node:fs";
import * as path from "node:path";
import { templates, defaultTemplateName, Template } from "./templates/index.js";

export interface CreateAppOptions {
  targetDir: string;
  templateName?: string;
}

export function sanitizeProjectName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/^-+|-+$/g, "") || "my-nexo-app";
}

export async function createNexoApp(options: CreateAppOptions): Promise<{
  projectName: string;
  targetPath: string;
  template: Template;
}> {
  const targetPath = path.resolve(process.cwd(), options.targetDir);
  const rawProjectName = path.basename(targetPath);
  const projectName = sanitizeProjectName(rawProjectName);

  const selectedTemplateName = options.templateName || defaultTemplateName;
  const template = templates[selectedTemplateName];

  if (!template) {
    const available = Object.keys(templates).filter((k) => k !== "backend").join(", ");
    throw new Error(
      `Unknown template "${selectedTemplateName}". Available templates: ${available}`
    );
  }

  // Generate template files with dynamic project name
  const files = template.getFiles(projectName);

  // Write files to target directory
  for (const file of files) {
    const filePath = path.join(targetPath, file.path);
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, file.content, "utf8");
  }

  return {
    projectName,
    targetPath,
    template
  };
}
