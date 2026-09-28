export function arrays(xs: number[]): string {
  const out: string[] = [];
  const copy = xs.slice();
  copy.push(100, 200);
  out.push(copy.join(","));
  out.push(String(xs.indexOf(3)), String(xs.includes(5)), String(xs.findIndex((x) => x > 2)));
  const found = xs.find((x) => x % 2 === 0);
  out.push(found === undefined ? "none" : String(found));
  out.push(
    xs
      .filter((x) => x > 1)
      .map((x) => x * 10)
      .join("|"),
  );
  out.push(String(xs.reduce((a, b) => a + b, 0)));
  out.push(String(xs.some((x) => x > 4)), String(xs.every((x) => x > 0)));
  const sorted = [...xs].sort((a, b) => b - a);
  out.push(sorted.join(","));
  out.push([10, 9, 1, 100].sort().join(","));
  const spliced = copy.splice(1, 2, 7, 8, 9);
  out.push(spliced.join(","), copy.join(","));
  out.push(String(copy.pop()), String(copy.shift()), copy.join(","));
  copy.unshift(-1);
  out.push(copy.reverse().join(","));
  out.push(String(copy.length), String(copy.at(-1)), String(copy.lastIndexOf(8)));
  const nested = [[1, 2], [3], []];
  out.push(nested.flatMap((a) => a).join(","));
  out.push(Array.from({ length: 5 }, (_, i) => i * i).join(","));
  out.push(new Array<number>(3).fill(7).join(","));
  const aliasA = [1, 2];
  const aliasB = aliasA;
  aliasB.push(3);
  out.push(String(aliasA.length));
  copy.length = 2;
  out.push(copy.join(","));
  let total = 0;
  xs.forEach((x, i) => {
    total += x * i;
  });
  out.push(String(total));
  return out.join(" / ");
}

export function words(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const w of text.split(" ")) {
    if (!w) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return counts;
}

export function mapOps(): string {
  const m = new Map<string, number>();
  m.set("b", 2).set("a", 1).set("c", 3);
  m.delete("a");
  m.set("a", 10);
  const parts: string[] = [];
  for (const [k, v] of m) parts.push(`${k}=${v}`);
  parts.push(String(m.size), String(m.has("b")), String(m.get("zz")));
  const keys = [...m.keys()].join(",");
  parts.push(keys);
  const s = new Set<number>([3, 1, 3, 2]);
  s.add(1);
  s.add(5);
  parts.push(String(s.size), [...s].join(","), String(s.has(2)));
  s.delete(3);
  parts.push(Array.from(s).join(","));
  return parts.join(" ");
}

export function records(r: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of Object.keys(r)) out[k.toUpperCase()] = (r[k] ?? 0) * 2;
  out["total"] = Object.values(r).reduce((a, b) => a + b, 0);
  delete out["B"];
  return out;
}

export function entries(r: Record<string, string>): string {
  return Object.entries(r)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}

export function matrix(n: number): number[][] {
  const rows: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < n; j++) row.push(i * n + j);
    rows.push(row);
  }
  return rows;
}

export function uniq(xs: string[]): string[] {
  return [...new Set(xs)];
}
