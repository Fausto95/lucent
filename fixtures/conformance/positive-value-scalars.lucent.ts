/** Value scalars round-trip with ordinary copy semantics (semantics § exit #1). */
export function add(a: number, b: number): number {
  return a + b;
}

export function label(name: string, n: number): string {
  return `${name}:${n}`;
}
