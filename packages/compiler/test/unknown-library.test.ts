/**
 * A native library Lucent has never seen, bound and run by rule (T28): its
 * module, class, callback, generic and async names are drawn at random on
 * every run, so nothing in Lucent can know them.
 *
 * fixtures/unknown-library holds the library and the app code using it.
 * "QXN"/"qxn" is replaced by the run's random prefix everywhere, file and
 * directory names included.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import {
  compileErrors,
  compiles,
  hostRun,
  iosProgram,
  prepareSwiftModules,
  type SwiftFixture,
  xcode,
} from "./swift-harness.ts";
import { canRunMounted, runMounted } from "./ui/mount-harness.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "fixtures/unknown-library");

/** A prefix nothing in Lucent can name: a letter, then four random bytes as letters. */
const prefix = `Z${crypto
  .randomBytes(4)
  .toString("hex")
  .replace(/\d/g, (d) => "QRSTUVWXYZ"[+d]!)
  .toUpperCase()}`;
const lower = prefix.toLowerCase();
const rename = (text: string) => text.replaceAll("QXN", prefix).replaceAll("qxn", lower);

/** The fixture under this run's names, in a fresh directory. */
function randomized(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-unknown-"));

  const copy = (from: string, to: string) => {
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const source = path.join(from, entry.name);
      const target = path.join(to, rename(entry.name));

      if (entry.isDirectory()) {
        fs.mkdirSync(target, { recursive: true });
        copy(source, target);
      } else {
        fs.writeFileSync(target, rename(fs.readFileSync(source, "utf8")));
      }
    }
  };

  copy(fixture, root);
  return root;
}

const root = randomized();

/** The library's Swift modules, its dependency first. */
const modules: SwiftFixture[] = ["Core", "Kit"].map((m) => ({
  name: `${prefix}${m}`,
  source: path.join(root, "ios", `${prefix}${m}`, `${prefix}${m}.swift`),
}));

const use = fs.readFileSync(path.join(root, "ios/use.ios.lucent.ts"), "utf8");

describe.skipIf(!xcode)("an unknown library on iOS", () => {
  beforeAll(() => prepareSwiftModules(modules), 300_000);

  it("binds its classes, callback, generic and async method by rule, and runs them", () => {
    const p = iosProgram(use, modules);

    expect(p.r.diagnostics).toEqual([]);
    expect(compileErrors(p)).toEqual(compiles);
    expect(hostRun(p)).toMatchObject({
      status: 0,
      stdout: `gauge g at 3.5 | 3 3.5 | 3.5 box | 7.0 ${lower} | Error\n`,
    });
  }, 600_000);
});

/** The library's view, a component of the app's: a dial whose turns become events. */
const dial = Object.fromEntries(
  ["dial.lucent.ts", "dial.ios.lucent.tsx", "dial.android.lucent.tsx"].map((f) => [
    f,
    fs.readFileSync(path.join(root, "ios", f), "utf8"),
  ]),
);

describe("an unknown library's view on iOS", () => {
  it.skipIf(!canRunMounted)(
    "mounts as a component: props, events and commands by rule, released with its mount",
    () => {
      const dials = path.join(root, "ios", `${prefix}Dials`);

      expect(
        runMounted(dial, path.join(root, "ios/dial_run.mm"), {
          includePaths: [dials],
          sources: [path.join(dials, `${prefix}Dials.m`)],
        }),
      ).toEqual([
        "mounted: level 2",
        "committed: level 5",
        "turned: level 6, sent 6",
        "command: answer 3 = 6",
        "disposed: block gone",
        "released: native references all released, dial gone",
      ]);
    },
    600_000,
  );
});
