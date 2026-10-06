// `in` sees the keys every object inherits from Object.prototype, on
// records and object types alike.
type P = { x: number; y: number };

export function inRecord(r: Record<string, number>, k: string): boolean {
  return k in r;
}

export function inObject(k: string): boolean {
  const p: P = { x: 1, y: 2 };
  return k in p;
}

export function literalKeys(): string {
  const p: P = { x: 1, y: 2 };
  return `${"x" in p} ${"toString" in p} ${"hasOwnProperty" in p}`;
}

export function enumerated(): string {
  const p: P = { x: 1, y: 2 };
  const keys: string[] = [];
  for (const k in p) keys.push(k);
  return `${keys.join(",")} ${Object.keys(p).join(",")}`;
}
