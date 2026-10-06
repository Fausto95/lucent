// Calls whose result is undefined or null, or that never return, still run
// when that result becomes another type: an optional, a union, an element.

let calls: string[] = [];

function bump(tag: string): undefined {
  calls.push(tag);
  return undefined;
}

function nothing(tag: string): null {
  calls.push(tag);
  return null;
}

function fail(tag: string): never {
  calls.push(tag);
  throw new Error(`no ${tag}`);
}

function show(value?: string): string {
  return value ?? "none";
}

function showNull(value: string | null): string {
  return value ?? "null";
}

function kind(value: number | string | undefined): string {
  return typeof value;
}

function attempt(run: () => string): string {
  calls = [];

  try {
    return `${run()} [${calls.join(",")}]`;
  } catch (e) {
    return `threw ${(e as Error).message} [${calls.join(",")}]`;
  }
}

type Named = { name?: string };

export function asArguments(): string {
  return attempt(
    () => `${show(bump("optional"))} ${showNull(nothing("null"))} ${kind(bump("union"))}`,
  );
}

export function asValues(): string {
  return attempt(() => {
    const _optional: string | undefined = bump("declared");
    const _orNull: number | null = nothing("declared null");
    const list: (string | undefined)[] = [bump("element")];
    const named: Named = { name: bump("field") };

    return `${list.length} ${named.name === undefined}`;
  });
}

export function asOperands(): string {
  return attempt(() => {
    const loose = bump("loose equality") == undefined;
    const fallback = bump("nullish") ?? "fallback";

    return `${loose} ${fallback}`;
  });
}

export function throwsAsArgument(): string {
  return attempt(() => show(fail("argument")));
}

export function throwsAsValue(): string {
  return attempt(() => {
    const _value: string | undefined = fail("declared");

    return "not thrown";
  });
}
