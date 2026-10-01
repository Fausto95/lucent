import { describe, expect, it } from "vite-plus/test";
import { coverage } from "../../src/ir/cpp.ts";
import { body, cppOf, inOrder, module } from "./compile.ts";

const SAMPLE = `import { compute } from "lucent:core";
function step(x: number): number {
  return (x * 31) % 1000003;
}
function spin(n: number): number {
  let x = 0;
  for (let i = 0; i < n; i++) x = step(x + i);
  for (const d of [1, 2]) x += d;
  return x;
}
export async function run(n: number): Promise<number> {
  return await compute(spin, n);
}
`;

describe("compute task variants in the IR", () => {
  it("lowers a task's variant, each loop iteration checking for cancellation first", () => {
    const before = coverage.lowered.length;
    const spin = body(cppOf(module(SAMPLE), "ir-strict"), "spin_task_");

    expect(coverage.lowered.slice(before)).toContain("lucent_app::m_sample::spin_task_");

    expect(spin).toMatch(/^::spin_task_\(double p0_, lucent::TaskContext& task_\) \{/);

    expect(inOrder(spin, "break;", "task_.checkCancelled();", "step_task_(")).toBe(true);

    expect(spin.match(/task_\.checkCancelled\(\);/g)).toHaveLength(2);
  });

  it("calls the variants of the functions a task calls", () => {
    const out = cppOf(module(SAMPLE), "ir-strict");

    expect(body(out, "spin_task_")).toMatch(/m_sample::step_task_\(v\d+_, task_\)/);

    expect(body(out, "step_task_")).toContain("task_");
  });
});
