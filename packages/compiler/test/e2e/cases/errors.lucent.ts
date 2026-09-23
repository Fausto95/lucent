import { error, errorCode } from "@lucent-lang/core";

export class ValidationError extends Error {
  constructor(message: string, readonly field: string) {
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
