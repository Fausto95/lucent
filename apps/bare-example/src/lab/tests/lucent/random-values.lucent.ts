// crypto.getRandomValues and crypto.randomUUID, from the platform's secure
// generator (T105). Random values differ between runs, so the case prints
// what holds of them rather than the values.

/** Whether the values differ: what a filled array's almost always do. */
function vary(values: string[]): boolean {
  return new Set(values).size > 1;
}

export function filled(): string {
  const bytes = new Uint8Array(64);
  const same = crypto.getRandomValues(bytes);
  const words = crypto.getRandomValues(new Int32Array(16));
  const wide = crypto.getRandomValues(new BigUint64Array(8));
  // A view fills its own bytes only.
  const whole = new Uint8Array(32);
  crypto.getRandomValues(whole.subarray(8, 24));
  let outside = 0;
  for (let i = 0; i < 32; i++) if ((i < 8 || i >= 24) && whole[i] !== 0) outside++;
  return [
    `the same array: ${same === bytes}`,
    `bytes vary: ${vary(Array.from(bytes, (x) => `${x}`))}`,
    `words vary: ${vary(Array.from(words, (x) => `${x}`))} (${words.length})`,
    `bigints vary: ${vary(Array.from(wide, (x) => `${x}`))} (${wide.length})`,
    `outside the view: ${outside}`,
    `the most: ${crypto.getRandomValues(new Uint8Array(65536)).length}`,
  ].join("\n");
}

export function tooMany(): string {
  try {
    crypto.getRandomValues(new Uint8Array(65537));
    return "filled";
  } catch (e) {
    if (e instanceof Error) return `${e.name}: ${e.message}`;
    throw e;
  }
}

export function uuids(count: number): string {
  const shape = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const seen = new Set<string>();
  let shaped = 0;
  for (let i = 0; i < count; i++) {
    const id = crypto.randomUUID();
    if (shape.test(id)) shaped++;
    seen.add(id);
  }
  return `${shaped} of ${count} shaped as version 4, ${seen.size} different`;
}
