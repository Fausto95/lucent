import type { Root } from "mdast";
import { describe, expect, it } from "vite-plus/test";
import lucent from "../../../packages/lucent/package.json" with { type: "json" };
import { remarkVersion } from "../src/docs/remark.ts";

const tree = (...values: string[]): Root => ({
  type: "root",
  children: values.map((value) => ({ type: "code", lang: "sh", value })),
});

describe("remarkVersion", () => {
  it("writes the current Lucent version where a sample says {{lucent-version}}", () => {
    const root = tree("◆ lucent {{lucent-version}}\n✓ built", "npm i -D @lucent-lang/lucent");
    remarkVersion()(root);

    expect(root.children.map((c) => (c.type === "code" ? c.value : ""))).toEqual([
      `◆ lucent ${lucent.version}\n✓ built`,
      "npm i -D @lucent-lang/lucent",
    ]);
  });
});
