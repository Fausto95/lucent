export function basics(): string {
  const re = /(\d{4})-(\d{2})-(\d{2})/;
  const m = re.exec("on 2024-02-29 at noon");
  const parts = m ? `${m[0]} ${m[1]} ${m[2]} ${m[3]} @${m.index}` : "no match";
  return [parts, re.test("nope"), re.source, re.flags, /a/gi.flags, re.global].join(" | ");
}

export function named(): string {
  const m = /(?<year>\d{4})-(?<month>\d{2})/u.exec("x 1999-12 y");
  return `${m?.groups?.year} ${m?.groups?.month} ${m?.groups?.day}`;
}

export function globalExec(): string {
  const re = /o(\w)/g;
  const out: string[] = [];
  for (let m = re.exec("foo boa fox"); m !== null; m = re.exec("foo boa fox")) out.push(`${m[1]}@${m.index}/${re.lastIndex}`);
  return out.join(",");
}

export function stringMethods(s: string): string {
  return [
    JSON.stringify(s.match(/\b\w/g)),
    JSON.stringify(s.match(/(qu)(i)/)?.slice(0, 3)),
    s.search(/o/),
    s.replace(/o/g, "0"),
    s.replace(/(\w+) (\w+)/, "$2 $1"),
    s.replace(/o/g, "[$&]"),
    s.replaceAll(/(?<v>[aeiou])/g, "<$<v>>"),
    s.replace(/\w+/g, (w) => w.toUpperCase()),
    s.split(/\s+/).join("|"),
    s.split(/(o)/).length,
    s.split(/ /, 2).join("|"),
    "a1b22c333".split(/\d+/).join(","),
  ].join(" ; ");
}

export function matchAllGroups(): string {
  const out: string[] = [];
  for (const m of "k1=v1;k2=v2;k3=".matchAll(/(\w+)=(\w*)/g)) out.push(`${m[1]}:${m[2] || "-"}@${m.index}`);
  return out.join(" ");
}

export function flags(): string {
  return [
    /^b/m.test("a\nb"),
    /^b/.test("a\nb"),
    /a.c/s.test("a\nc"),
    /a.c/.test("a\nc"),
    /ABC/i.test("abc"),
    /\u{1F600}/u.test("😀"),
    /^.$/u.test("😀"),
    /^.$/.test("😀"),
    /(?<=\$)\d+/.exec("cost $42")?.[0],
    /(?<!\$)\b\d+/.exec("cost $42 or 17")?.[0],
    /(a)|(b)/.exec("b")?.[1],
    /\bfoo\b/.test("a foo b"),
    /[\p{L}]+/u.exec("123 héllo")?.[0],
  ].join(",");
}

export function sticky(): string {
  const re = /\d/y;
  const out: string[] = [];
  out.push(`${re.test("12a3")} ${re.lastIndex}`);
  out.push(`${re.test("12a3")} ${re.lastIndex}`);
  out.push(`${re.test("12a3")} ${re.lastIndex}`);
  re.lastIndex = 3;
  out.push(`${re.test("12a3")} ${re.lastIndex}`);
  return out.join(" | ");
}

export function dynamic(pattern: string, flags: string, input: string): string {
  try {
    const re = new RegExp(pattern, flags);
    return JSON.stringify(input.match(re));
  } catch (e) {
    return (e as Error).name;
  }
}

export function callbackReplace(s: string): string {
  return s.replace(/(\d+)(px)?/g, (whole: string, n: string, unit: string | undefined, offset: number) => `${Number(n) * 2}${unit ?? "!"}@${offset}`);
}
