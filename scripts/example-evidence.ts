/**
 * What each example package under examples/ has run on, and the words its
 * README says it in. The record is the package's evidence.json, so the
 * README cannot claim more than was run, and a run that raises a level
 * changes one file:
 *
 *   [{ "level": "sim", "date": "2026-09-25", "how": "in the example apps' Lab" }]
 *
 * Levels are docs/tasks.md's evidence levels, lowest first: code (written),
 * host (compiled without either SDK), sim (the iOS simulator or the
 * Android emulator), device (physical devices), external (independent
 * use). A higher level never follows from a lower one.
 *
 *   node scripts/example-evidence.ts    # rewrites each README's evidence block
 *
 * packages/lucent/test/examples.test.ts checks that each README carries
 * the block its record makes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const LEVELS = ["code", "host", "sim", "device", "external"] as const;

export type Level = (typeof LEVELS)[number];

export type Platform = "ios" | "android";

export interface Evidence {
  /** The part of the package the record covers, when its parts differ (a component, a module). */
  subject?: string;
  level: Level;
  /** The platforms a simulator or device run covered; both when left out. */
  platforms?: Platform[];
  /** The day of a run CI doesn't repeat, as YYYY-MM-DD. */
  date?: string;
  /** Where and how it ran: a phrase that follows the level's words. */
  how: string;
}

const START = "<!-- evidence: from evidence.json, written by scripts/example-evidence.ts -->";
const END = "<!-- /evidence -->";

/** Where a simulator or device run happened, by its platforms. */
function ran(device: boolean, platforms: Platform[] = ["ios", "android"]): string {
  const where = device
    ? { ios: "physical iPhones", android: "physical Android phones" }
    : { ios: "the iOS simulator", android: "the Android emulator" };
  return `run on ${platforms.map((p) => where[p]).join(" and ")}`;
}

/** What a level claims, as words a sentence starts with. */
function claim(e: Evidence): string {
  switch (e.level) {
    case "code":
      return "written";
    case "host":
      return "compiled for the host, without either SDK,";
    case "sim":
      return ran(false, e.platforms);
    case "device":
      return ran(true, e.platforms);
    case "external":
      return "used by independent authors";
  }
}

/** What the level leaves unproven, as a sentence. */
function notYet(e: Evidence): string {
  switch (e.level) {
    case "code":
      return " Not yet compiled against either SDK, or run.";
    case "host":
      return " Not yet typed against the SDKs, or run on a simulator, an emulator or a device.";
    case "sim":
      return " Not yet run on a physical device.";
    case "device":
    case "external":
      return "";
  }
}

const capitalized = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One record as the README states it. */
export function sentence(e: Evidence): string {
  const date = e.date ? ` (${e.date})` : "";
  const text = `${claim(e)} ${e.how}${date}.${notYet(e)}`;
  return e.subject ? `\`${e.subject}\`: ${text}` : capitalized(text);
}

/** The README's evidence block for a package's records. */
export function evidenceBlock(records: Evidence[]): string {
  const body =
    records.length === 1
      ? `**Evidence:** ${sentence(records[0]!)}`
      : `**Evidence:**\n\n${records.map((e) => `- ${sentence(e)}`).join("\n")}`;
  return `${START}\n\n${body}\n\n${END}`;
}

/** A package's evidence.json, checked: each record's level, platforms, date and words. */
export function readEvidence(dir: string): Evidence[] {
  const file = path.join(dir, "evidence.json");
  const records: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(records) || records.length === 0)
    throw new Error(`${file}: expected a non-empty array of records`);
  return records.map((r: Record<string, unknown>, i) => {
    const at = `${file} [${i}]`;
    const known = new Set(["subject", "level", "platforms", "date", "how"]);
    for (const key of Object.keys(r))
      if (!known.has(key)) throw new Error(`${at}: unknown field "${key}"`);
    if (!LEVELS.includes(r.level as Level))
      throw new Error(`${at}: level must be one of ${LEVELS.join(", ")}`);
    if (typeof r.how !== "string" || !r.how) throw new Error(`${at}: "how" must be a phrase`);
    if (r.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(r.date)))
      throw new Error(`${at}: "date" must be YYYY-MM-DD`);
    if (r.platforms !== undefined) {
      const ps = r.platforms as unknown[];
      if (
        !Array.isArray(ps) ||
        ps.length === 0 ||
        ps.some((p) => p !== "ios" && p !== "android") ||
        new Set(ps).size !== ps.length
      )
        throw new Error(`${at}: "platforms" must list "ios", "android" or both`);
      if (r.level !== "sim" && r.level !== "device")
        throw new Error(`${at}: "platforms" belongs to a simulator or device run`);
    }
    if ((r.level === "device" || r.level === "external") && r.date === undefined)
      throw new Error(`${at}: a ${String(r.level)} record needs its date`);
    return r as unknown as Evidence;
  });
}

/** `readme` with its evidence block replaced by `block`, or added at its end. */
export function withEvidence(readme: string, block: string): string {
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start >= 0 && end > start)
    return readme.slice(0, start) + block + readme.slice(end + END.length);
  return `${readme.trimEnd()}\n\n${block}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const examples = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../examples");
  for (const name of fs.readdirSync(examples).sort()) {
    const dir = path.join(examples, name);
    if (!fs.existsSync(path.join(dir, "evidence.json"))) continue;
    const file = path.join(dir, "README.md");
    const before = fs.readFileSync(file, "utf8");
    const after = withEvidence(before, evidenceBlock(readEvidence(dir)));
    if (after !== before) {
      fs.writeFileSync(file, after);
      console.log(`wrote examples/${name}/README.md`);
    }
  }
}
