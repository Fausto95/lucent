// An error's cause (T106): new Error(message, { cause }), read back as an
// Error, and crossing to JavaScript and back with the error.
class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    cause?: Error,
  ) {
    super(message, { cause });
    this.name = "AppError";
  }
}

class PlainError extends Error {}

function describe(e: Error): string {
  const cause = e.cause instanceof Error ? `${e.cause.name}: ${e.cause.message}` : "no cause";
  return `${e.name}: ${e.message} <- ${cause}`;
}

export function wrapped(): string {
  try {
    try {
      throw new TypeError("inner");
    } catch (e) {
      throw new Error("outer", { cause: e });
    }
  } catch (e) {
    return describe(e as Error);
  }
}

export function noCause(): string {
  return `${describe(new Error("alone"))} | ${describe(new RangeError("range", undefined))}`;
}

export function subclasses(): string {
  const inner = new RangeError("too big");
  const app = new AppError("failed", "E_APP", inner);
  const plain = new PlainError("plain", { cause: app });
  return `${describe(app)} | ${describe(plain)} | ${app.code}`;
}

export function chain(): string {
  const root = new Error("root");
  const middle = new Error("middle", { cause: root });
  const top = new Error("top", { cause: middle });
  const names: string[] = [];
  let at: Error | undefined = top;
  while (at) {
    names.push(at.message);
    at = at.cause instanceof Error ? at.cause : undefined;
  }
  return names.join(" <- ");
}

export function asError(): string {
  const e = new Error("outer", { cause: new Error("inner") });
  return (e.cause as Error).message;
}

export function optionalCause(given: boolean): string {
  const maybe: Error | undefined = given ? new Error("maybe") : undefined;
  return describe(new Error("outer", { cause: maybe }));
}

export function toJavaScript(): Error {
  return new Error("outer", { cause: new TypeError("inner") });
}

export function fromJavaScript(e: Error): string {
  return describe(e);
}
