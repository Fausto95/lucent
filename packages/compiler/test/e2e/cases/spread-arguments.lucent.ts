// Spread arguments from tuples (T106): into fixed parameters, after them,
// into a rest parameter, and from tuples into arrays and built-ins.
function point(x: number, y: number, label?: string): string {
  return `${x},${y}${label ? ` ${label}` : ""}`;
}

function sum(first: number, ...rest: number[]): string {
  let total = first;
  for (const r of rest) total += r;
  return `${first}+${rest.length} more=${total}`;
}

class Box {
  constructor(readonly width: number) {}

  area(height: number, scale: number): number {
    return this.width * height * scale;
  }
}

export function intoFixed(): string {
  const p: [number, number] = [1, 2];
  return point(...p);
}

export function withOptional(): string {
  const p: [number, number, string] = [1, 2, "a"];
  const q: [number, number] = [3, 4];
  return `${point(...p)} | ${point(...q)}`;
}

export function afterFixed(): string {
  const yLabel: [number, string] = [5, "b"];
  return point(4, ...yLabel);
}

export function intoRest(): string {
  const t: [number, number, number] = [1, 2, 3];
  const more: [number, number] = [4, 5];
  return `${sum(...t)} | ${sum(0, ...more, 6)}`;
}

export function evaluatedOnce(): string {
  let calls = 0;
  const pair = (): [number, number] => {
    calls++;
    return [7, 8];
  };
  return `${point(...pair())} ${calls}`;
}

export function methodsAndConstructors(): string {
  const size: [number] = [4];
  const args: [number, number] = [2, 3];
  return String(new Box(...size).area(...args));
}

export function tupleIntoArray(): string {
  const t: [number, string, boolean] = [1, "a", true];
  const xs = [0, ...t];
  return JSON.stringify(xs);
}

export function intoBuiltins(): string {
  const t: [number, number] = [3, 9];
  const parts: string[] = [];
  parts.push(...(["x", "y"] as [string, string]));
  return `${Math.max(...t)} ${Math.min(...t)} ${parts.join("")}`;
}
