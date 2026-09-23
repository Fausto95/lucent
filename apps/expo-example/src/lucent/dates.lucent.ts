// Dates. Output is independent of the time zone: local getters are checked
// against getTimezoneOffset() instead of printed.

export function utc(): string {
  const d = new Date(Date.UTC(2024, 1, 29, 13, 45, 30, 123));
  return [
    d.getTime(),
    d.toISOString(),
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    d.getUTCDay(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds(),
    d.toUTCString(),
    JSON.stringify({ d }),
    d.valueOf() === d.getTime(),
  ].join(" | ");
}

export function parse(): string {
  const inputs = [
    "2024-02-29",
    "2024-02-29T13:45:30.123Z",
    "2024-02-29T13:45:30+02:00",
    "2024-02-29T13:45:30.5-03:30",
    "+010000-01-01T00:00:00Z",
    "-000001-12-31T23:59:59.999Z",
    "2024",
    "2024-06",
    "2024-02-29T24:00:00Z",
    "Mon, 22 Jul 2019 22:51:50 GMT",
    "Mon Jul 22 2019 15:51:50 GMT-0700",
    "not a date",
    "2024-13-01",
    "",
  ];
  return inputs.map((s) => Date.parse(s)).join(",");
}

export function local(): string {
  const d = new Date(2024, 5, 15, 10, 30, 5, 250);
  const asUtc = Date.UTC(2024, 5, 15, 10, 30, 5, 250);
  const e = new Date(2023, 11, 31, 23, 59);
  return [
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
    d.getMilliseconds(),
    d.getDay(),
    asUtc - d.getTime() === -d.getTimezoneOffset() * 60000,
    e.getFullYear(),
    e.getMonth(),
    e.getDate(),
    new Date(2024, 0, 1).getTime() === new Date(2024, 0).getTime(),
    new Date(99, 0).getFullYear(),
    new Date("2024-02-29T13:45").getTime() === new Date(2024, 1, 29, 13, 45).getTime(),
  ].join(",");
}

export function setters(): string {
  const d = new Date(Date.UTC(2024, 0, 31));
  const out: string[] = [];
  d.setUTCMonth(1);
  out.push(d.toISOString());
  d.setUTCDate(0);
  out.push(d.toISOString());
  d.setUTCHours(25, 61, 61, 1001);
  out.push(d.toISOString());
  d.setUTCFullYear(2023, 1, 29);
  out.push(d.toISOString());
  out.push(`${d.setTime(0)} ${d.toISOString()}`);
  const l = new Date(2024, 0, 31, 12);
  l.setMonth(1);
  out.push(`${l.getMonth()}/${l.getDate()} ${l.getHours()}`);
  l.setDate(l.getDate() + 30);
  out.push(`${l.getMonth()}/${l.getDate()}`);
  l.setHours(0, 0, 0, 0);
  out.push(`${l.getHours()}:${l.getMinutes()}`);
  l.setFullYear(2025);
  out.push(`${l.getFullYear()}`);
  return out.join(" | ");
}

export function invalid(): string {
  const d = new Date(Number.NaN);
  const out = [`${d.getTime()}`, `${Number.isNaN(d.getFullYear())}`, String(d), JSON.stringify({ d }), `${new Date(8.64e15 + 1).getTime()}`, `${new Date(8.64e15).getTime()}`];
  try {
    d.toISOString();
  } catch (e) {
    out.push((e as Error).name);
  }
  d.setUTCHours(1);
  out.push(`${d.getTime()}`);
  return out.join(" | ");
}

export function compare(): string {
  const a = new Date(1000);
  const b = new Date(2000);
  const c = new Date(a);
  return [a < b, a > b, a <= c, a === c, a.getTime() === c.getTime(), +b, b.getTime() - a.getTime(), new Date(-1).toISOString(), new Date(-62198755200000).toISOString()].join(",");
}

export function now(): boolean {
  const t = Date.now();
  return t > 1.6e12 && new Date().getTime() >= t;
}

export function shift(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86400000);
}

export function describe(d: Date): string {
  return `${d.toISOString()} ${d.getUTCDay()}`;
}
