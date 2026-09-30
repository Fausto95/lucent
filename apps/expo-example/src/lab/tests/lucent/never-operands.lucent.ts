// Operands typed never (calls that always throw) in `??`, `||`, `&&` and
// conditional expressions: the expression has the other operand's type,
// and the throw happens only when the never operand runs.

let calls: string[] = [];

function fail(what: string): never {
  calls.push(what);
  throw new Error(`no ${what}`);
}

function attempt(run: () => string): string {
  calls = [];

  try {
    return `${run()} [${calls.join(",")}]`;
  } catch (e) {
    return `threw ${(e as Error).message} [${calls.join(",")}]`;
  }
}

class Account {
  name: string;

  constructor(name: string) {
    this.name = name;
  }

  missing(what: string): never {
    return fail(`${this.name} ${what}`);
  }
}

export function nullish(name?: string, count?: number | null): string {
  return attempt(() => {
    const upper = (name ?? fail("name")).toUpperCase();
    const doubled = (count ?? fail("count")) * 2;

    return `${upper} ${doubled}`;
  });
}

export function nullishObject(present: boolean): string {
  return attempt(() => {
    const maybe = present ? new Account("ada") : undefined;
    const account = maybe ?? fail("account");

    return account.name;
  });
}

export function nullishMethod(present: boolean): string {
  return attempt(() => {
    const account = new Account("bob");
    const nickname: string | undefined = present ? "bobby" : undefined;

    return nickname ?? account.missing("nickname");
  });
}

export function nullishArrow(present: boolean): string {
  return attempt(() => {
    const reject = (what: string): never => fail(what);
    const value: number | undefined = present ? 7 : undefined;

    return String(value ?? reject("value"));
  });
}

export function logical(text: string, ok: boolean, n: number): string {
  return attempt(() => {
    const nonEmpty = text || fail("text");
    const notOk = ok && fail("ok");
    const zero = n && fail("n");

    return `${nonEmpty} ${notOk} ${zero}`;
  });
}

export function conditional(which: number): string {
  return attempt(() => {
    const first = which === 1 ? fail("first") : "first ok";
    const second = which === 2 ? "second ok" : fail("second");

    return `${first} ${second}`;
  });
}

export function assigns(start?: string): string {
  return attempt(() => {
    let value = start;

    value ??= fail("start");

    return value;
  });
}
