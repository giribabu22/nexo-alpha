export function formatName(name: string): string {
  return name.trim();
}

export function greet(name: string): string {
  return "Hello, " + formatName(name);
}
