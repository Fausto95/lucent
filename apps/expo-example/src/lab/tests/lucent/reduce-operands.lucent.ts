// A reduce's initial value may be any expression: it runs after the
// receiver and before the callback first runs, as in JavaScript.
export function fromField(xs: number[], o: { n: number }): number {
  return xs.reduce((a, c) => a + c, o.n);
}

let calls = "";
function log(s: string, v: number): number {
  calls += s;
  return v;
}

export function order(): string {
  calls = "";
  const r = [1, 2].map((x) => log("m", x)).reduce((a, c) => log("r", a + c), log("i", 10));
  return `${calls}=${r}`;
}

export function initialArray(xs: string[]): string[] {
  return xs.reduceRight((acc, x) => [...acc, x.toUpperCase()], xs.slice(0, 1));
}
