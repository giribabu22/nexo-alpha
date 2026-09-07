export function pingA(): void {
  pingB();
}

export function pingB(): void {
  pingA();
}
