export function add(a: number, b: number): number {
  return a + b;
}

export function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export async function total(values: number[]): Promise<number> {
  let sum = 0;
  for (const value of values) {
    sum += value;
  }
  return sum;
}

export function divide(a: number, b: number): number {
  if (b === 0) {
    throw new LucentError("DIVIDE_BY_ZERO", { message: "Cannot divide by zero" });
  }
  return a / b;
}
