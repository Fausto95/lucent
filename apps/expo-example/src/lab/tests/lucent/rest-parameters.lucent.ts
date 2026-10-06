export function sum(...xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

export function tag(name: string, ...rest: (string | number)[]): string {
  return `${name}:${rest.length}:${rest.join(",")}`;
}

export async function later(...words: string[]): Promise<string> {
  return words.join(" ");
}

export class Path {
  readonly parts: string[];

  constructor(...parts: (string | Path)[]) {
    this.parts = [];
    for (const p of parts) {
      if (typeof p === "string") this.parts.push(p);
      else this.parts.push(...p.parts);
    }
  }

  join(...more: string[]): string {
    return [...this.parts, ...more].join("/");
  }

  static of(...parts: string[]): Path {
    return new Path(...parts);
  }
}

export class Logger {
  log(prefix: string, ...values: number[]): string {
    return `${prefix}${values.join("+")}`;
  }
}

export class LoudLogger extends Logger {
  override log(prefix: string, ...values: number[]): string {
    return super.log(prefix.toUpperCase(), ...values, values.length);
  }
}

// Calls from Lucent: none, some, spread arrays and a mix of both.
export function internal(): string {
  const xs = [4, 5];
  const mixed: (string | number)[] = ["b", 2];
  const loggers: Logger[] = [new Logger(), new LoudLogger()];

  return [
    sum(),
    sum(1, 2, 3),
    sum(...xs),
    sum(1, ...xs, 6, ...xs),
    tag("t"),
    tag("t", 1, "a", ...mixed),
    new Path("a", new Path("b", "c"), "d").join("e"),
    Path.of(...new Set(["x", "y"])).join(),
    loggers.map((l) => l.log("n=", 1, 2)).join(" "),
  ].join(" | ");
}
