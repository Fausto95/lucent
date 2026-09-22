import { expect, test } from "vite-plus/test";
import { compile } from "../../compiler/src/index.ts";
import { expoHost } from "../../host-expo/src/index.ts";
import { nitroHost } from "../../host-nitro/src/index.ts";
import { counter } from "../../compiler/test/samples.ts";
for (const host of [expoHost, nitroHost])
  test(`${host.name} invokes synchronous SDK calls outside registry synchronization`, () => {
    const result = compile(counter, { fileName: "counter.lucent.ts" });
    expect(result.diagnostics).toEqual([]);
    const files = host.emitPackage([result.module!], { packageName: "lucent" });
    const swift = [...files]
      .filter(([path]) => path.endsWith(".swift") && !path.includes("Runtime"))
      .map(([, text]) => text)
      .join("\n");
    const kotlin = [...files]
      .filter(([path]) => path.endsWith(".kt") && !path.includes("Runtime"))
      .map(([, text]) => text)
      .join("\n");
    expect(swift).toContain("LucentObjectRegistry.shared.withObjects(");
    expect(kotlin).toContain("LucentObjectRegistry.withObjects(");
    expect(swift).toContain("lucentLeases.get(");
    expect(kotlin).toContain("lucentLeases.get(");
    expect(swift).not.toContain("LucentObjectRegistry.shared.withLock");
    expect(kotlin).not.toContain("LucentObjectRegistry.withLock");
  });
