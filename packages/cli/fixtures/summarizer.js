export function summarize(node) {
  return node.kind === "module" ? `Summary: ${node.name}` : undefined;
}
