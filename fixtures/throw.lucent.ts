export function divide(a: number, b: number): number {
  if (b === 0) {
    throw new LucentError("DIVIDE_BY_ZERO", { message: "Cannot divide by zero" });
  }
  return a / b;
}

export function fail(): void {
  throw new LucentError("ALWAYS");
}

export function failWithMetadata(path: string): void {
  throw new LucentError("MISSING", {
    message: "File\n不存在 🌍",
    metadata: { path, attempt: 1, retry: false, detail: null },
  });
}
