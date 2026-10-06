// Array.isArray and instanceof test the value a union holds, whatever
// its static type: a tuple and a RegExp match are arrays too.
/* oxlint-disable unicorn/no-instanceof-builtins -- what instanceof Array gives is the case */

export function isArrays(x: string | string[]): string {
  if (Array.isArray(x)) return `array of ${x.length}`;

  return `string ${x}`;
}

export function tupleIsArray(): string {
  const t: [number, string] = [1, "a"];

  return `${Array.isArray(t)} ${t instanceof Array}`;
}

export function matchIsArray(s: string): boolean {
  return Array.isArray(s.match(/a/));
}

function arrayKind(x: number[] | string[]): string {
  return x instanceof Array ? "array" : "other";
}

export function unionOfArrays(): string {
  const numbers: number[] = [1];
  const words: string[] = ["a"];

  return `${arrayKind(numbers)} ${arrayKind(words)}`;
}

function joined(x: string[] | string | undefined): string {
  return x instanceof Array ? x.join("+") : String(x);
}

// The array is made here: one the test passed in would come from the
// reference run's other realm, where instanceof Array is false.
export function instanceOfArray(): string {
  return [joined(["a", "b"]), joined("s"), joined(undefined)].join(" ");
}

function kinds(m: Map<string, number> | string | undefined, d: Date | number | undefined): string {
  return `${m instanceof Map}/${d instanceof Date}`;
}

export function instanceOfKinds(): string {
  return [
    kinds(new Map<string, number>(), new Date(0)),
    kinds("m", 0),
    kinds(undefined, undefined),
  ].join(" ");
}
