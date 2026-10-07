// Components' setups lowered through the IR: the mount as an ambient
// the functions they make enter and capture, and what setup code cannot do as a diagnostic.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { compile, type CompileResult, sdkAvailable } from "../../src/index.ts";

const ios = process.platform === "darwin" && sdkAvailable("ios");

/** A Label component for iOS, `body` its setup's code after it makes the label. */
function label(body: string): CompileResult {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-ir-setup-"));
  const files = {
    "label.lucent.ts": `import type { UILabel } from "lucent:ios/UIKit";

export declare function Label(props: { text: string }): UILabel;
`,
    "label.ios.lucent.tsx": `import { UILabel } from "lucent:ios/UIKit";
import { effect, invalidateSize, onDispose } from "lucent:ui";

export function Label(props: { text: string }): UILabel {
  const label = new UILabel();
${body}
  return label;
}
`,
  };

  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/app" }));

  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);

  return compile(
    Object.keys(files).map((f) => path.join(dir, f)),
    { platforms: ["ios"] },
  );
}

/** The setup's definition, without the #line directives. */
function setupOf(r: CompileResult): string {
  const unit = r.files.get("ios/m_label.mm") ?? "";
  const start = unit.indexOf("m_label::Label_setup(");
  const end = unit.indexOf("\nvoid m_label::init()");

  return unit
    .slice(start, end)
    .split("\n")
    .filter((l) => !l.startsWith("#line"))
    .join("\n");
}

describe.skipIf(!ios)("component setups in the IR", () => {
  it("takes the props as the IR's parameter, then the command table", () => {
    const r = label(`  effect(() => {
    label.text = props.text;
  });`);

    expect(r.diagnostics).toEqual([]);

    expect(r.files.get("ios/m_label.h")).toContain(
      "lucent::NativeRef Label_setup(lucent_app::m_label::Label_Props p0_, Label_Commands& lucent_commands);",
    );

    expect(setupOf(r)).toContain("[label = label, props = p0_]() mutable -> void {");
  });

  it("makes each function a setup makes enter its mount, which those reading it capture", () => {
    const r = label(`  effect(() => {
    label.text = props.text;
    invalidateSize();
  });
  onDispose(() => {
    label.text = "";
  });`);
    const setup = setupOf(r);

    expect(r.diagnostics).toEqual([]);

    expect(setup).toContain("auto lucent_content = lucent::ui::activeContent();");

    expect(setup).toContain(
      "lucent::ui::inContent(lucent_content, [label = label, props = p0_, lucent_content = lucent_content]() mutable -> void {",
    );

    expect(setup).toContain("lucent::ui::invalidateSize(lucent_content);");

    expect(setup).toContain(
      "lucent::ui::inContent(lucent_content, [label = label]() mutable -> void {",
    );
  });

  it("declares no mount for a setup whose code never reads it", () => {
    const r = label("");

    expect(r.diagnostics).toEqual([]);

    expect(setupOf(r)).not.toContain("lucent_content");
  });

  it("keeps the mount for an async function's code after an await", () => {
    const r = label(`  const later = async (): Promise<void> => {
    await Promise.resolve();
    invalidateSize();
  };
  effect(() => {
    void later();
  });`);

    expect(r.diagnostics).toEqual([]);

    // A coroutine's frame takes its captures as parameters: the mount among them.
    expect(setupOf(r)).toMatch(/\[\]\(auto lucent_content\) -> lucent::Promise<void> \{/);
  });

  it("reports code it cannot compile as a LUCENT diagnostic", () => {
    const r = label(`  var count = 0;
  effect(() => {
    label.text = String(count);
  });`);

    expect(r.diagnostics.map((d) => d.code)).toContain("LUCENT1001");
  });
});
