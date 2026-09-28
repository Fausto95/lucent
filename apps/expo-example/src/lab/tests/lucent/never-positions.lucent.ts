// Calls that always throw where a value is expected: arguments, assignments,
// fields, elements, template parts, operands and conditions. The call runs
// and throws; nothing after it in the expression does.

let calls: string[] = [];

function fail(tag: string): never {
  calls.push(tag);
  throw new Error(`no ${tag}`);
}

function note(tag: string): string {
  calls.push(tag);

  return tag;
}

function log(tag: string): void {
  calls.push(tag);
}

function attempt(run: () => string): string {
  calls = [];

  try {
    return `${run()} [${calls.join(",")}]`;
  } catch (e) {
    return `threw ${(e as Error).message} [${calls.join(",")}]`;
  }
}

function take(value: string): string {
  return `took ${value}`;
}

function pair(first: string, second: number): string {
  return `${first}:${second}`;
}

function defaulted(value: string = fail("default")): string {
  return value;
}

interface Named {
  name: string;
  size: number;
}

class Counter {
  count: number;
  label = "";

  constructor(start: number) {
    this.count = start;
  }
}

class Eager {
  value: string = fail("field initializer");
}

let shared = new Counter(0);

export function argument(ok: boolean): string {
  return attempt(() => (ok ? take("value") : take(fail("argument"))));
}

export function arguments_(ok: boolean): string {
  return attempt(() => (ok ? pair("a", 1) : pair(note("first"), fail("second"))));
}

export function constructed(ok: boolean): string {
  return attempt(() => (ok ? "skipped" : String(new Counter(fail("constructor")).count)));
}

export function defaults(ok: boolean): string {
  return attempt(() => (ok ? defaulted("given") : defaulted()));
}

export function initialized(ok: boolean): string {
  return attempt(() => (ok ? "skipped" : new Eager().value));
}

export function assigned(ok: boolean): string {
  return attempt(() => {
    let s = "start";

    if (ok) return s;

    s = fail("assignment");

    return s;
  });
}

export function assignedField(ok: boolean): string {
  return attempt(() => {
    const counter = new Counter(0);

    if (!ok) counter.count = fail("field assignment");

    return String(counter.count);
  });
}

export function compound(ok: boolean): string {
  return attempt(() => {
    let n = 1;

    if (!ok) n += fail("compound");

    return String(n);
  });
}

export function compoundShared(ok: boolean): string {
  return attempt(() => {
    shared = new Counter(0);

    if (!ok) shared.label += fail("compound field");

    return `${shared.label}.`;
  });
}

export function field(ok: boolean): string {
  return attempt(() => {
    if (ok) return "skipped";

    const named: Named = { name: note("name"), size: fail("size") };

    return `${named.name}${named.size}`;
  });
}

export function element(ok: boolean): string {
  return attempt(() => {
    if (ok) return "skipped";

    const items: string[] = [note("first"), fail("element")];

    return items.join(",");
  });
}

export function tuple(ok: boolean): string {
  return attempt(() => {
    if (ok) return "skipped";

    const entry: [string, number] = ["key", fail("tuple")];

    return entry[0];
  });
}

export function pushed(ok: boolean): string {
  return attempt(() => {
    const items: number[] = [];

    if (!ok) items.push(fail("push"));

    return items.join(",");
  });
}

export function mapped(ok: boolean): string {
  return attempt(() => {
    const map = new Map<string, number>();

    if (!ok) map.set("k", fail("map value"));

    return String(map.get("k"));
  });
}

export function template(ok: boolean): string {
  return attempt(() => (ok ? "plain" : `${note("head")} ${fail("template")} tail`));
}

export function operands(ok: boolean): string {
  return attempt(() => (ok ? "0" : String(1 + fail("operand"))));
}

export function unary(ok: boolean): string {
  return attempt(() => (ok ? "0" : String(-fail("minus"))));
}

export function compared(ok: boolean): string {
  return attempt(() => (ok ? "0" : String(fail("less") < 1)));
}

export function condition(ok: boolean): string {
  return attempt(() => {
    if (ok) return "skipped";

    if (fail("if")) return "yes";

    return "no";
  });
}

export function negated(ok: boolean): string {
  return attempt(() => (ok ? "skipped" : String(!fail("not"))));
}

export function leftOperand(ok: boolean): string {
  return attempt(() => (ok ? "skipped" : fail("or") || "fallback"));
}

export function looped(ok: boolean): string {
  return attempt(() => {
    let turns = 0;

    if (ok) while (turns < 2) turns++;
    else while (fail("while")) turns++;

    return String(turns);
  });
}

export function switched(ok: boolean): string {
  return attempt(() => {
    if (ok) return "skipped";

    switch (fail("switch")) {
      default:
        return "matched";
    }
  });
}

type Shape = "circle" | "square";

function assertNever(value: never): never {
  throw new Error(`unexpected ${String(value)}`);
}

export function exhaustive(shape: Shape): string {
  switch (shape) {
    case "circle":
      return "round";
    case "square":
      return "boxy";
    default:
      return assertNever(shape);
  }
}

// Calls that return nothing hold no value either: as template parts, they
// run in order and read as undefined.
export function nothing(): string {
  return attempt(() => `${note("head")} ${log("first")} ${log("second")}`);
}
