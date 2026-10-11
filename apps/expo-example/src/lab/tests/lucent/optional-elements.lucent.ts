// Collections whose elements may be absent: a read gives the element as it
// is (undefined or null included), or undefined when there is none.

export function arrays(xs: (number | undefined)[], i: number): string {
  const v = xs[i];
  return `${v === undefined ? "none" : v} ${xs.at(i) ?? -1}`;
}

export function maps(): string {
  const m = new Map<string, number | undefined>();
  m.set("a", 1);
  m.set("b", undefined);
  const a = m.get("a");
  return `${a ?? -1} ${m.get("b") ?? -1} ${m.get("c") ?? -1} ${m.has("b")} ${m.size}`;
}

export function records(r: Record<string, number | undefined>, k: string): string {
  const v = r[k];
  return `${v === undefined ? "none" : v} ${r[k] ?? -1} ${Object.keys(r).join(",")}`;
}

export function madeRecords(): string {
  const r: Record<string, number | undefined> = {};
  r["a"] = 1;
  r["b"] = undefined;
  const p: Partial<Record<string, string[]>> = {};
  p["x"] = ["1"];
  return `${records(r, "a")} | ${records(r, "b")} | ${records(r, "c")} | ${JSON.stringify(r)} | ${p["x"]?.length} ${p["y"]?.length}`;
}

/** Null stays null: only a missing element reads as undefined. */
export function nulls(): string {
  const m = new Map<string, number | null>();
  m.set("n", null);
  const n = m.get("n");
  const r: Record<string, number | null> = { n: null, v: 2 };
  const rn = r["n"];
  const xs: (string | null)[] = [null, "a"];
  const x0 = xs[0];
  return [
    n === null,
    m.get("x") === undefined,
    rn === null,
    r["x"] === undefined,
    r["v"],
    x0 === null,
    xs[5] === undefined,
  ].join(" ");
}
