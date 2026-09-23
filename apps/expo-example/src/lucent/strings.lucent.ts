export function stats(s: string): string {
  const upper = s.toUpperCase();
  const words = s.split(" ").filter((w) => w.length > 0);
  const first = words[0] ?? "";
  return `${upper}|${s.length}|${words.length}|${first}|${s.indexOf("o")}|${s.slice(-3)}|${s.charCodeAt(0)}`;
}

export function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

export function reverseWords(s: string): string {
  return s.split(" ").reverse().join(" ");
}

export function countChars(s: string): number {
  let n = 0;
  for (const ch of s) {
    if (ch !== " ") n++;
  }
  return n;
}

export function builder(n: number): string {
  let out = "";
  for (let i = 0; i < n; i++) {
    out += i % 2 === 0 ? "a" : "b";
    if (i % 10 === 9) out += "\n";
  }
  return out.trim();
}

export function manip(s: string): string[] {
  return [
    s.replace("l", "L"),
    s.replaceAll("l", "L"),
    s.substring(1, 4),
    s.at(-1) ?? "none",
    s.repeat(2),
    s.trim(),
    s.startsWith("he") ? "yes" : "no",
    s.endsWith("lo") ? "yes" : "no",
    s.includes("ell") ? "yes" : "no",
    s.charAt(1),
    s.toLowerCase(),
    `${s.codePointAt(0)}`,
    s.padEnd(8, "."),
    s.split("").join("-"),
  ];
}

export function compare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function unicode(): string {
  const s = "héllo wörld 🌍 ÀÉÎ";
  return `${s.length} ${s.toUpperCase()} ${s.toLowerCase()} ${[...s].length} ${s.codePointAt(12)}`;
}

export function unicodeCase(words: string[]): string {
  return words.map((w) => `${w.toUpperCase()}/${w.toLowerCase()}`).join(" ");
}

export function collate(words: string[]): string {
  return [...words].sort((a, b) => a.localeCompare(b)).join("|");
}

/** Template literals: every kind of interpolated value, formatted as JavaScript does. */
export function templates(xs: number[], k: number, flag: boolean, name: string, maybe: string | undefined): string[] {
  const out: string[] = [];
  for (const x of xs) out.push(`[${x}]`);
  for (let i = 0; i < 3; i++) out.push(`${i}:${i * 0.5}:${i | 0}:${k >>> 0}:${(k * 31) % 997}`);
  out.push(`${flag}-${!flag}`, `${name}${name}`, `é${name}`, `${maybe}|${maybe ?? "none"}`, `${k}`, `${""}`, `a${""}b`);
  return out;
}
