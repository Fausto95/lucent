// @ts-expect-error Lucent function decorator; compiled before TypeScript.
@Background
export async function summarize(values: number[]): Promise<number> {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total;
}

// @ts-expect-error Lucent function decorator; compiled before TypeScript.
@MainThread
export async function label(count: number): Promise<string> {
  return `count: ${count}`;
}
