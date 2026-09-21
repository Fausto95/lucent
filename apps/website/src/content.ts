export const examples = {
  swift: {
    platform: "iOS",
    extension: ".swift",
    code: "func clamp(\n  value: Double, min: Double, max: Double\n) throws -> Double {\n  if value < min { return min }\n  if value > max { return max }\n  return value\n}",
  },
  kotlin: {
    platform: "Android",
    extension: ".kt",
    code: "fun clamp(\n  value: Double, min: Double, max: Double\n): Double {\n  if (value < min) { return min }\n  if (value > max) { return max }\n  return value\n}",
  },
};
export const source =
  "export function clamp(value: number, min: number, max: number): number {\n  if (value < min) return min;\n  if (value > max) return max;\n  return value;\n}";
export const commands =
  "git clone https://github.com/Fausto95/lucent.git\ncd lucent\nbun install\nbun run lucent build --host expo fixtures/clamp.lucent.ts";
