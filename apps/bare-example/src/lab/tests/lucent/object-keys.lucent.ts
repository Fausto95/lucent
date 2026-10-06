// `in` on a record sees the keys every object inherits from
// Object.prototype. Object types refuse `in`, for…in and Object.keys.
export function inRecord(r: Record<string, number>, k: string): boolean {
  return k in r;
}

export function literalKeys(): string {
  const r: Record<string, number> = { x: 1, y: 2 };
  return `${"x" in r} ${"toString" in r} ${"hasOwnProperty" in r}`;
}

export function enumerated(): string {
  const r: Record<string, number> = { x: 1, y: 2 };
  const keys: string[] = [];
  for (const k in r) keys.push(k);
  return `${keys.join(",")} ${Object.keys(r).join(",")}`;
}
