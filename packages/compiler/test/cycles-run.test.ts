// A debug build's cycle report, end to end (TA41): classes and objects the
// compiler emits report their fields' references, and the runtime's walk
// finds the cycles among the objects a program left alive, each named by
// the fields and source lines that close it.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { hostLibs } from "../../runtime/test/sources.ts";
import { compile, runtimeDir } from "../src/index.ts";
import { buildObjects } from "./parallel-build.ts";

const cxx = [process.env.CXX, "clang++", "g++"].find(
  (c) => !!c && spawnSync(c, ["--version"]).status === 0,
);
const cc = [process.env.CC, "clang", "gcc"].find(
  (c) => !!c && spawnSync(c, ["--version"]).status === 0,
);

const SOURCE = `import { EventEmitter } from "lucent:core";

export class Session {
  onFrame: Handler | undefined;
  frames = 0;

  constructor(readonly name: string) {}
}

export class Handler {
  constructor(readonly owner: Session) {}
}

class Tree {
  children: Leaf[] = [];
}

class Leaf {
  constructor(readonly parent: WeakRef<Tree>) {}
}

type Link = { name: string; next: Link | undefined };

class Camera {
  readonly frames = new EventEmitter<{ frame: (n: number) => void }>();
  count = 0;

  start(): void {
    this.frames.addListener("frame", (n) => {
      this.count += n;
    });
  }
}

class Player {
  onEnd: (() => void) | undefined;
  ended = false;
}

/** A session and its handler, which holds the session back. */
export function leak(): number {
  const s = new Session("camera");
  s.onFrame = new Handler(s);
  return 1;
}

/** Children that hold their tree through a WeakRef: nothing left. */
export function tree(): number {
  const t = new Tree();
  t.children.push(new Leaf(new WeakRef(t)));
  return t.children.length;
}

/** A listener that captures what holds its emitter. */
export function listen(): number {
  const camera = new Camera();
  camera.start();
  return camera.count;
}

/** A callback stored on what it captures, and one that captures only numbers. */
export function callback(): number {
  const player = new Player();
  player.onEnd = () => {
    player.ended = true;
  };
  let calls = 0;
  const counted = new Player();
  counted.onEnd = () => {
    calls++;
  };
  counted.onEnd();
  return calls;
}

/** Objects that are a ring. */
export function ring(): number {
  const a: Link = { name: "a", next: undefined };
  const b: Link = { name: "b", next: a };
  a.next = b;
  return 2;
}
`;

const MAIN = `#include <cstdio>

#include "lucent/lucent.h"
#include "m_cycles.h"

int main() {
  lucent::debug::trackObjects();
  lucent_app::m_cycles::tree();
  lucent_app::m_cycles::leak();
  lucent_app::m_cycles::ring();
  lucent_app::m_cycles::listen();
  if (lucent_app::m_cycles::callback() != 1) return 1;
  for (const auto& c : lucent::debug::cycles()) std::printf("%s\\n", lucent::debug::describe(c).c_str());
  return 0;
}
`;

describe("a debug build's cycle report", () => {
  it.skipIf(!cxx || !cc)(
    "names the fields, closures and lines of each cycle a program leaves, and none a WeakRef breaks",
    () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cycles-run-"));
      const file = path.join(dir, "cycles.lucent.ts");
      fs.writeFileSync(file, SOURCE);

      const result = compile([file]);
      expect(result.diagnostics).toEqual([]);
      for (const [name, text] of result.files) fs.writeFileSync(path.join(dir, name), text);
      fs.writeFileSync(path.join(dir, "main.cpp"), MAIN);

      const cpp = path.join(runtimeDir(), "cpp");
      const runtime = fs
        .readdirSync(path.join(cpp, "lucent"))
        .filter((f) => f.endsWith(".cpp"))
        .map((f) => path.join(cpp, "lucent", f));
      const regexp = fs
        .readdirSync(path.join(cpp, "third_party/quickjs"))
        .filter((f) => f.endsWith(".c"))
        .map((f) => path.join(cpp, "third_party/quickjs", f));
      const own = [path.join(dir, "main.cpp"), path.join(dir, "m_cycles.cpp")];
      const flags = ["-std=c++20", "-ffp-contract=off", "-O0", `-I${cpp}`, "-w"];
      const { objects, printed } = buildObjects(
        dir,
        [...own, ...runtime, ...regexp],
        (source) =>
          source.endsWith(".c")
            ? { cmd: cc!, args: ["-std=c11", "-O1", "-w", "-c", source] }
            : {
                cmd: cxx!,
                args: [...flags, ...(own.includes(source) ? [`-I${dir}`] : []), "-c", source],
              },
        (source) => !own.includes(source),
      );
      expect(printed).toBe("");

      const binary = path.join(dir, "cycles");
      // The runtime's localeCompare uses CoreFoundation on a Mac.
      const link = spawnSync(cxx!, [...objects, "-lpthread", ...hostLibs, "-o", binary], {
        encoding: "utf8",
      });
      expect(link.stderr).toBe("");

      const run = spawnSync(binary, { encoding: "utf8" });
      expect(run.status).toBe(0);
      expect(run.stdout.trim().split("\n").sort()).toEqual([
        "a reference cycle keeps 1 object alive: Player.onEnd (cycles.lucent.ts:36), then the closure at cycles.lucent.ts:64, which captures player, to itself. Capture a WeakRef of player in the closure at cycles.lucent.ts:64 to break it.",
        "a reference cycle keeps 2 objects alive: Camera.frames (cycles.lucent.ts:25), then the frame listener, then the closure at cycles.lucent.ts:29, which captures this, back to the first. Capture a WeakRef of this in the closure at cycles.lucent.ts:29 to break it.",
        "a reference cycle keeps 2 objects alive: Link.next, then Link.next, back to the first. Hold Link.next through a WeakRef to break it.",
        "a reference cycle keeps 2 objects alive: Session.onFrame (cycles.lucent.ts:4), then Handler.owner (cycles.lucent.ts:11), back to the first. Hold Handler.owner through a WeakRef to break it.",
      ]);
    },
    300_000,
  );
});
