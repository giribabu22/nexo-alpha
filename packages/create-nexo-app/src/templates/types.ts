export interface TemplateFile {
  path: string;
  content: string;
}

export interface Template {
  name: string;
  description: string;
  getFiles: (projectName: string) => TemplateFile[];
}
