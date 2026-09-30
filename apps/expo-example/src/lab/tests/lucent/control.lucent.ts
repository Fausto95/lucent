export function classify(n: number): string {
  let out = "";
  switch (n) {
    case 0:
      out += "zero ";
    case 1:
      out += "small ";
      break;
    case 2:
    case 3: {
      const x = n * 10;
      out += `medium${x} `;
      break;
    }
    default:
      out += "big ";
  }
  return out.trim();
}

export function labeled(): string {
  const found: string[] = [];
  outer: for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      if (j === 3) continue outer;
      if (i === 3) break outer;
      if ((i + j) % 2 === 0) continue;
      found.push(`${i}${j}`);
    }
  }
  return found.join(",");
}

export function finallyOrder(): string {
  const log: string[] = [];
  const f = (x: number): number => {
    try {
      log.push("try");
      if (x > 0) return x * 2;
      log.push("after");
    } finally {
      log.push("finally");
    }
    return -1;
  };
  const a = f(1);
  const b = f(0);
  return `${a} ${b} ${log.join(",")}`;
}

export function nestedFinally(): string {
  const log: string[] = [];
  for (let i = 0; i < 3; i++) {
    try {
      try {
        if (i === 1) continue;
        if (i === 2) break;
        log.push(`body${i}`);
      } finally {
        log.push(`inner${i}`);
      }
    } finally {
      log.push(`outer${i}`);
    }
  }
  return log.join(",");
}

export function catches(kind: string): string {
  try {
    if (kind === "type") throw new TypeError("bad type");
    if (kind === "range") throw new RangeError("out of range");
    if (kind === "plain") throw new Error("plain");
    return "none";
  } catch (e) {
    if (e instanceof TypeError) return `type:${e.message}`;
    if (e instanceof Error) return `${e.name}:${e.message}`;
    return "unknown";
  } finally {
    // runs, but does not change the result
  }
}

export function whileLoops(n: number): number[] {
  const out: number[] = [];
  let i = 0;
  while (true) {
    i++;
    if (i > n) break;
    if (i % 2) continue;
    out.push(i);
  }
  let k = 10;
  do {
    out.push(k);
    k -= 4;
  } while (k > 0);
  return out;
}

export function ternaries(xs: (number | undefined)[]): string[] {
  return xs.map((x) => (x === undefined ? "u" : x > 0 ? "pos" : x < 0 ? "neg" : "zero"));
}

export function logic(a: string, b: number): string {
  const s = a || "default";
  const t = a && "set";
  const n = b || 99;
  const z = b ?? 5;
  return `${s}|${t}|${n}|${z}`;
}

export function forIn(r: Record<string, number>): string {
  const keys: string[] = [];
  for (const k in r) keys.push(k);
  return keys.join(",");
}

export function earlyReturnInLoop(xs: number[], target: number): number {
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] === target) return i;
  }
  return -1;
}
