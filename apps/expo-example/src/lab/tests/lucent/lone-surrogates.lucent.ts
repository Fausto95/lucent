// Lone surrogates are valid string contents in JavaScript: UTF-16 code
// units with no pair, which no UTF-8 spelling can hold.

const high: string = "\uD800";
const low: string = "a\uDC00b";

function codes(s: string): string {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i));

  return out.join(" ");
}

export function lengths(): string {
  return [high.length, low.length, "\uDBFF\uDBFF".length, "x\uD83D".length].join(" ");
}

export function units(): string {
  return [codes(high), codes(low), codes(`<${high}|\uDFFF>`), String(high.codePointAt(0))].join(
    " / ",
  );
}

export function comparisons(): string {
  const pair = high + "\uDC00";

  return [
    high === "\uD800",
    high === "\uD801",
    high < "\uDC00",
    pair === "\u{10000}",
    pair.length,
    low.slice(1, 2) === "\uDC00",
    low.indexOf("\uDC00"),
  ].join(" ");
}

export function templated(n: number): string {
  return `${n}\uD800${n}`;
}

export function stringified(): string {
  return JSON.stringify([high, low]);
}

export function echo(s: string): string {
  return s;
}

export function same(s: string): boolean {
  return s === "\uDC00";
}
