// Calls that always throw where a value is expected: returned from a
// function that gives one, or declared as a typed variable.

let calls: string[] = [];

function fail(tag: string): never {
  calls.push(tag);
  throw new Error(`no ${tag}`);
}

function attempt(run: () => string): string {
  calls = [];

  try {
    return `${run()} [${calls.join(",")}]`;
  } catch (e) {
    return `threw ${(e as Error).message} [${calls.join(",")}]`;
  }
}

class Registry {
  names = new Map<string, string>();

  lookup(key: string): string {
    const name = this.names.get(key);

    if (name !== undefined) return name;

    return fail(`name for ${key}`);
  }
}

function parse(text: string): number {
  const n = Number(text);

  if (Number.isNaN(n)) return fail(`number in ${text}`);

  return n;
}

export function returned(text: string): string {
  return attempt(() => String(parse(text)));
}

export function fromMethod(key: string): string {
  const registry = new Registry();

  registry.names.set("a", "ada");

  return attempt(() => registry.lookup(key));
}

export function fromArrow(ok: boolean): string {
  const pick = (): string => (ok ? "picked" : fail("pick"));
  const reject = (): string => fail("reject");

  return attempt(() => (ok ? pick() : reject()));
}

export function declared(ok: boolean): string {
  return attempt(() => {
    if (ok) return "skipped";

    const name: string = fail("const");

    return name;
  });
}

export function declaredLet(ok: boolean): string {
  return attempt(() => {
    if (ok) return "skipped";

    let count: number = fail("let");

    count += 1;

    return String(count);
  });
}
