type Item = { name: string; price: number; tags: string[]; note?: string; discount: number | null };
type Order = {
  id: number;
  items: Item[];
  paid: boolean;
  meta: Record<string, number>;
  point: [number, number];
};

export function summarize(text: string): string {
  const o = JSON.parse(text) as Order;
  const total = o.items.reduce((sum, it) => sum + it.price * (1 - (it.discount ?? 0)), 0);
  const notes = o.items.map((it) => it.note ?? "-").join("/");
  return `#${o.id} ${o.items.length} items ${total.toFixed(2)} paid=${o.paid} ${notes} ${Object.keys(o.meta).join("+")} (${o.point[0]}, ${o.point[1]})`;
}

export function roundTrip(text: string): string {
  const o: Order = JSON.parse(text);
  return JSON.stringify(o);
}

export function numbers(): string {
  const ns = JSON.parse(
    " [1, -0, 1e21, 0.1, 1E-7, -12.5e3, 123456789012345678901234567890] ",
  ) as number[];
  return ns.map((n) => `${n}${n === 0 && 1 / n < 0 ? "(-0)" : ""}`).join(",");
}

export function strings(): string {
  const s = JSON.parse('"a\\u00e9\\ud83d\\ude00\\n\\t\\"q\\"\\\\/"') as string;
  return `${s.length} ${JSON.stringify(s)}`;
}

type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };

export function shapes(text: string): string {
  const xs = JSON.parse(text) as Shape[];
  return xs.map((s) => (s.kind === "circle" ? `c${s.r}` : `s${s.side}`)).join(" ");
}

export function mixed(): string {
  const v = JSON.parse('[1, "two", true, null, 2.5]') as (number | string | boolean | null)[];
  return v.map((x) => `${typeof x}:${x}`).join(",");
}

export function lastKeyWins(): number {
  const o = JSON.parse('{"a": 1, "a": 2}') as { a: number };
  return o.a;
}

export function invalid(texts: string[]): string {
  return texts
    .map((t) => {
      try {
        const v = JSON.parse(t) as number[];
        return `ok${v.length}`;
      } catch (e) {
        return (e as Error).name;
      }
    })
    .join(",");
}
