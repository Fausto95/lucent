import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { compile } from "../src/index.ts";

/** The diagnostics of module `m`, as "code line: message". */
function refusals(source: string): string[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-events-"));
  const file = path.join(dir, "m.lucent.ts");
  fs.writeFileSync(file, source);
  return compile([file]).diagnostics.map((d) => `${d.code} ${d.line}: ${d.message}`);
}

const IMPORTS = `import { compute, EventEmitter } from "lucent:core";\n`;

describe("EventEmitter", () => {
  it("names each event by a string literal in Lucent", () => {
    expect(
      refusals(`${IMPORTS}
const events = new EventEmitter<{ a: (n: number) => void; b: () => void }>();
export function send(name: "a" | "b"): void {
  if (name === "a") events.emit(name, 1);
  events.emit("b");
  events.listenerCount(name);
}
`),
    ).toEqual([
      "LUCENT1007 7: an event's name is a string literal here: JavaScript may name it with any string",
    ]);
  });

  it("needs named events whose listeners return nothing", () => {
    expect(
      refusals(`${IMPORTS}
export const counted = new EventEmitter<{ a: (n: number) => number }>();
export const any = new EventEmitter<Record<string, () => void>>();
export const optional = new EventEmitter<{ a?: () => void }>();
`),
    ).toEqual([
      "LUCENT2002 3: the event a needs a listener signature that returns void, as in `a: (value: number) => void`",
      "LUCENT2002 4: an EventEmitter's events are named: give it an object type with one listener signature per event, as in EventEmitter<{ change: (value: number) => void }>",
      "LUCENT2002 5: the event a needs a listener signature that returns void, as in `a: (value: number) => void`",
    ]);
  });

  it("keeps emitters out of compute tasks", () => {
    expect(
      refusals(`${IMPORTS}
const events = new EventEmitter<{ a: (n: number, label?: string) => void }>();
function task(e: EventEmitter<{ a: (n: number, label?: string) => void }>): number {
  return e.listenerCount("a");
}
export async function send(): Promise<number> {
  events.emit("a", 1);
  events.emit("a", 1, "one");
  return await compute(task, events);
}
`),
    ).toEqual([expect.stringMatching(/^LUCENT3012 10: .*an event emitter/)]);
  });
});
