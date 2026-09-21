export function divide(a: number, b: number): number {
  if (b === 0) {
    throw new LucentError("DIVIDE_BY_ZERO", { message: "Cannot divide by zero" });
  }
  return a / b;
}

export function fail(): void {
  throw new LucentError("ALWAYS");
}
