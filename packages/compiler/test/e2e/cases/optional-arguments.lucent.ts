// A built-in's optional argument passed as a value that may be undefined:
// JavaScript reads undefined as the argument left out, or as NaN.

type Check = (at?: number, sep?: string) => string;

function checks(): Check[] {
  const text = "abcabc";
  const xs = [1, 2, 3, 1, 2, 3];
  const bytes = new Uint8Array([1, 2, 3, 1, 2, 3]);

  const strings: Check[] = [
    (at) => String(text.indexOf("b", at)),
    (at) => String(text.lastIndexOf("b", at)),
    (at) => String(text.includes("a", at)),
    (at) => String(text.startsWith("c", at)),
    (at) => String(text.endsWith("c", at)),
    (at) => text.slice(at),
    (at) => text.slice(1, at),
    (at) => text.substring(1, at),
    (at) => text.substr(1, at),
    (_, sep) => text.padStart(8, sep),
    (_, sep) => text.padEnd(8, sep),
    (at) => "a,b,c".split(",", at).join("|"),
    (at) => "a,b,c".split(/,/, at).join("|"),
  ];

  const arrays: Check[] = [
    (at) => xs.slice(at).join(),
    (at) => xs.slice(1, at).join(),
    (at) => {
      const ys = [...xs];
      const removed = ys.splice(1, at);

      return `${removed.join()}/${ys.join()}`;
    },
    (_, sep) => xs.join(sep),
    (at) => [0, 0, 0, 0].fill(7, at).join(),
    (at) => [0, 0, 0, 0].fill(7, 1, at).join(),
    (at) => String(xs.indexOf(2, at)),
    (at) => String(xs.lastIndexOf(2, at)),
    (at) => String(xs.includes(1, at)),
  ];

  const typed: Check[] = [
    (at) => bytes.subarray(at).join(),
    (at) => bytes.slice(1, at).join(),
    (at) => new Uint8Array(4).fill(7, at).join(),
    (at) => new Uint8Array(4).fill(7, 1, at).join(),
    (at) => String(bytes.indexOf(2, at)),
    (at) => String(bytes.includes(1, at)),
    (at) => {
      const t = new Uint8Array(4);
      t.set([9], at);

      return t.join();
    },
    (_, sep) => bytes.join(sep),
  ];

  const numbers: Check[] = [
    (at) => (255).toString(at),
    (at) => (1.25).toFixed(at),
    (at) => (123.456).toPrecision(at),
    (at) => (123.456).toExponential(at),
    (at) => 255n.toString(at),
    (at) => String(parseInt("11", at)),
    (at) => String(Number.parseInt("11", at)),
  ];

  const dates: Check[] = [
    (at) => String(new Date(2020, 1, at).getTime()),
    (at) => String(new Date(2020, 1, 15).setHours(10, at)),
    (at) => String(new Date(2020, 1, 15).setMinutes(5, at)),
    (at) => String(new Date(2020, 1, 15).setUTCFullYear(2021, at)),
  ];

  return [...strings, ...arrays, ...typed, ...numbers, ...dates];
}

function attempt(check: Check, at?: number, sep?: string): string {
  try {
    return check(at, sep);
  } catch (e) {
    return (e as Error).name;
  }
}

export function absent(at?: number, sep?: string): string[] {
  return checks().map((check) => attempt(check, at, sep));
}

// A NaN argument is not an undefined one: JavaScript reads it through
// ToIntegerOrInfinity, as 0.
export function nanArguments(nan: number): string[] {
  return [
    attempt(() => (255).toString(nan)),
    attempt(() => "abcdef".substr(nan, 2)),
    attempt(() => "abcdef".substr(-2, nan)),
  ];
}
