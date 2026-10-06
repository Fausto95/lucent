// JavaScript reads an exported `let` live, as an ES module binding: it
// sees each value the module assigns.
type Config = { size: number };

export let count = 0;
export let config: Config = { size: 1 };
export const limit = 3;

export function bump(): number {
  count++;
  return count;
}

export function grow(): void {
  config = { size: config.size + 1 };
}
