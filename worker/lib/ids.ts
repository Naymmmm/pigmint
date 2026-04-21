export function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 22)}`;
}

export function now(): number {
  return Math.floor(Date.now() / 1000);
}
