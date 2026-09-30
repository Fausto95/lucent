import { beforeAll, describe, expect, it } from "vite-plus/test";
import { extractIos } from "@lucent-lang/bindgen";
import { swiftModule } from "../../bindgen/test/swift-module.ts";
import { sdkDts } from "../src/sdk/dts.ts";
import {
  compileErrors,
  compiles,
  hostRun,
  iosProgram,
  prepareSwiftModules,
  xcode,
} from "./swift-harness.ts";

/**
 * A Swift package's async API as Lucent calls it: an async, throwing
 * method with a default argument, returning Swift values.
 */
const search = `import { SearchClient } from "lucent:ios/Orbit";

async function searchTitles(prefix: string): Promise<string[]> {
  const hits = await new SearchClient().search(prefix);
  return hits.map((hit) => hit.title);
}

export async function run(): Promise<string> {
  const titles = await searchTitles("or");

  // The default Swift fills in, and one given.
  const client = new SearchClient();
  const two = await client.search("o", 2n);

  // A Swift struct is a boxed object: every reference sees a change.
  const hit = two[0]!;
  const alias = hit;
  alias.score = 5;

  let failed = "";
  try {
    await client.search("!");
  } catch (e) {
    failed = (e as Error).message.includes("SearchError") ? "SearchError" : (e as Error).message;
  }

  return \`\${titles.join(",")}|\${two.map((h) => h.title).join(",")}|\${hit.score}|\${failed}|\${client.searches}\`;
}
`;

/** Aborting the call's signal cancels the Swift task: the promise rejects at once. */
const cancelled = `import { SearchClient } from "lucent:ios/Orbit";
import { delay } from "lucent:core";

export async function run(): Promise<string> {
  const client = new SearchClient();

  const early = new AbortController();
  early.abort();
  let skipped = "";
  try {
    await client.slowSearch("o", 0, early.signal);
  } catch (e) {
    skipped = (e as Error).name;
  }

  const controller = new AbortController();
  const slow = client.slowSearch("o", 30, controller.signal);
  await delay(10);
  controller.abort();

  let aborted = "";
  try {
    await slow;
  } catch (e) {
    aborted = (e as Error).name;
  }

  // Given time to finish, the cancelled task never searched.
  await delay(50);
  const quick = await client.slowSearch("oc", 0.01);

  return \`\${skipped} \${aborted} \${quick.map((h) => h.title).join(",")} \${client.searches}\`;
}
`;

describe.skipIf(!xcode)("Swift async APIs: the Search fixture", () => {
  beforeAll(() => prepareSwiftModules(["Orbit"]), 300_000);

  it("calls async throwing members with defaults, returning boxed values", () => {
    const p = iosProgram(search, ["Orbit"]);

    expect(p.r.diagnostics).toEqual([]);
    expect(compileErrors(p)).toEqual(compiles);
    expect(hostRun(p)).toMatchObject({
      status: 0,
      stdout: "orbit,orange,origin|orbit,orange|5|SearchError|2\n",
    });
  }, 600_000);

  it("takes an AbortSignal last, which cancels the Swift task", () => {
    const [schema] = extractIos({ modules: ["Orbit"], includePaths: [swiftModule("Orbit")] });

    expect(sdkDts(schema!)).toContain(
      "slowSearch(prefix: string, seconds: number, signal?: AbortSignal): Promise<SearchHit[]>;",
    );

    const p = iosProgram(cancelled, ["Orbit"]);
    expect(p.r.diagnostics).toEqual([]);
    expect(compileErrors(p)).toEqual(compiles);
    expect(hostRun(p)).toMatchObject({ status: 0, stdout: "AbortError AbortError ocean 1\n" });
  }, 600_000);
});
