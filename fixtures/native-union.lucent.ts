export type Result = {kind: "ok"; value: number} | {kind: "error"; message: string};
export function evaluate(value: number): Result {
  if (value < 0) { return {kind: "error", message: "Negative"}; }
  return {kind: "ok", value};
}
export function read(result: Result): number {
  if (result.kind === "ok") { return result.value; }
  return 0;
}
