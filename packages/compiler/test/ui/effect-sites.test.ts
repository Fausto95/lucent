// Each effect a component's setup makes says where it is (T61): its runs
// are trace spans at the .lucent.ts line of the code it runs, so a trace
// shows which bindings run, how often and for how long.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { compile, sdkAvailable } from "../../src/index.ts";
import { SETTINGS } from "./native-jsx-fixture.ts";

describe.skipIf(!sdkAvailable("ios"))("an effect's trace site", () => {
  afterEach(() => {
    delete process.env.LUCENT_VIEWS;
  });

  it("is the line of the attribute it keeps up to date", () => {
    process.env.LUCENT_VIEWS = "fabric";
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-effect-sites-"));

    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/app" }));
    for (const [f, text] of Object.entries(SETTINGS)) fs.writeFileSync(path.join(dir, f), text);

    const r = compile(
      Object.keys(SETTINGS).map((f) => path.join(dir, f)),
      { platforms: ["ios"] },
    );
    const setup = r.files.get("ios/m_settings.mm") ?? "";
    const effects = setup.split("lucent::ui::effect(").slice(1);

    expect(r.diagnostics).toEqual([]);
    expect(effects.length).toBeGreaterThan(0);

    // `<UILabel text={props.title} … />` is line 7 of settings.ios.lucent.tsx.
    for (const e of effects)
      expect(e).toMatch(
        /, LUCENT_TRACE_SITE_AT\("effect", "[^"]*settings\.ios\.lucent\.tsx", \d+\)\);/,
      );
    expect(setup).toContain('settings.ios.lucent.tsx", 7)');
  });
});
