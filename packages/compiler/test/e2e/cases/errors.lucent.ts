import { error, errorCode } from "lucent:core";

export class ValidationError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export function divide(a: number, b: number): number {
  if (b === 0) throw error("DIVIDE_BY_ZERO", "Cannot divide by zero");
  return a / b;
}

export function validate(age: number): string {
  if (age < 0) throw new ValidationError("age must be positive", "age");
  return "ok";
}

export function safeDivide(a: number, b: number): string {
  try {
    return String(divide(a, b));
  } catch (e) {
    const err = e as Error;
    return `failed: ${errorCode(err)} ${err.message}`;
  }
}

export function rethrow(): string {
  try {
    try {
      validate(-1);
    } catch (e) {
      if (e instanceof ValidationError) {
        throw new Error(`wrapped ${e.field}: ${e.message}`);
      }
      throw e;
    }
  } catch (e) {
    return (e as Error).message;
  }
  return "unreachable";
}

export function outOfBounds(xs: number[]): number {
  return xs[10]!;
}

export function failDeep(): number {
  throw new TypeError("deep");
}

export function passThrough(f: () => number): number {
  return f();
}

/** An error is named after the constructor that made it. */
export function kinds(): string[] {
  return [new Error("a"), new TypeError("b"), new RangeError("c"), new SyntaxError("d")].map(
    (e) => `${e.name}:${e instanceof SyntaxError}:${String(e)}`,
  );
}

export function syntax(): Error {
  return new SyntaxError("bad");
}

/** Error classes without a constructor of their own take the message as Error does. */
class Plain extends Error {}

class Coded extends Error {
  code = 7;
}

class Deeper extends Plain {}

class Optioned extends Error {
  constructor(message?: string) {
    super(message, undefined);
  }
}

const describe = (e: Error): string => `${e.name}:${e.message}:${String(e)}`;

export function implicitConstructors(): string[] {
  return [new Plain("p"), new Coded("c"), new Deeper("d"), new Plain()].map(describe);
}

export function plain(): Error {
  return new Plain("thrown");
}

/** An undefined message is the message left out, and an undefined options argument has no cause. */
export function undefinedArguments(message?: string): string[] {
  return [
    new Error(message),
    new SyntaxError(message),
    new Error("e", undefined),
    new Plain(message),
    new Plain("p", undefined),
    new Optioned(message),
  ].map(describe);
}
