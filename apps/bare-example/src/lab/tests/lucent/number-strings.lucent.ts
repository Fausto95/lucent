/** Each value as String(x), a template literal and a concatenation print it. */
export function strings(values: number[]): string[] {
  return values.map((v) => `${String(v)} | ${v} | ` + v);
}

/** The other forms: exponential, fixed, precision and radix. */
export function forms(values: number[]): string[] {
  return values.map(
    (v) => `${v.toExponential()} | ${v.toFixed(3)} | ${v.toPrecision(17)} | ${v.toString(7)}`,
  );
}

/** Each value, and its negation, as console.log prints them. */
export function log(values: number[]): void {
  for (const v of values) console.log(v, -v);
}
