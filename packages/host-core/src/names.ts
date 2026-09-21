/** `async-sum` → `AsyncSum`: a safe identifier for class and file names. */
export function moduleIdentifier(name: string): string {
  return name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}
