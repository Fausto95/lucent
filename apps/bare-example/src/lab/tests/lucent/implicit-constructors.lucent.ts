// A class without a constructor gets JavaScript's implicit one, which
// passes every argument to its base: an Error subclass keeps its message.
export class ParseError extends Error {}

class Named extends Error {
  override name = "Named";
}

class Outer extends Error {}
class Inner extends Outer {}

class Base {
  constructor(
    public a: number,
    public b: string = "dflt",
  ) {}
}
class Derived extends Base {}
class Deeper extends Derived {
  extra = 7;
}

class CodedError extends Error {
  constructor(
    message: string,
    public code: number,
  ) {
    super(message);
  }
}
class SubCoded extends CodedError {}

export function parseError(): string {
  const e = new ParseError("bad");
  return `${e.message}|${e.name}|${e instanceof ParseError}|${e instanceof Error}`;
}

export function caught(): string {
  try {
    throw new ParseError("worse");
  } catch (e) {
    return (e as Error).message;
  }
}

export function withoutMessage(): string {
  return `[${new ParseError().message}]`;
}

export function named(): string {
  const n = new Named("nm");
  return `${n.message} ${n.name}`;
}

export function twoLevels(): string {
  const e = new Inner("deep");
  return `${e.message} ${e instanceof Outer} ${e instanceof Error}`;
}

export function derived(): string {
  const d = new Derived(1, "x");
  const e = new Deeper(2);
  return `${d.a} ${d.b} ${e.a} ${e.b} ${e.extra}`;
}

export function subCoded(): string {
  const s = new SubCoded("m", 3);
  return `${s.message} ${s.code}`;
}

export function thrown(): void {
  throw new ParseError("to js");
}

export function messageOf(e: ParseError): string {
  return e.message;
}
