import fs from "node:fs";
import path from "node:path";
import { Codes } from "../../packages/compiler/src/codes.ts";
import {
  type Difference,
  differences,
  features,
  knownGaps,
  leftOut,
  type Refusal,
  type Sample,
} from "../../apps/website/src/docs/language.ts";
import { compileSamples } from "./compile.ts";
import { root } from "./context.ts";

const casesDir = path.join(root, "packages/compiler/test/e2e/cases");

/** The e2e cases: each `<name>.lucent.ts` or `<name>/` with its `<name>.test.js`. */
export function e2eCases(dir = casesDir): Set<string> {
  return new Set(
    fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".test.js"))
      .map((f) => f.slice(0, -".test.js".length)),
  );
}

const files = (s: Sample) => (typeof s === "string" ? { "example.lucent.ts": s } : s);

let n = 0;
/** The codes a sample fails with; none when it compiles. */
function codesOf(sample: Sample): string[] {
  const { diagnostics } = compileSamples(
    `language-${n++}`,
    Object.entries(files(sample)).map(([filename, code]) => ({ filename, code })),
  );
  return diagnostics.map((d) => d.code);
}

export interface LanguageData {
  features: { feature: string; cases?: string[]; refused?: Refusal[]; accepted?: Sample[] }[];
  leftOut: { feature: string; refused: Refusal[] }[];
  differences: { title: string; rows: Difference[] }[];
  knownGaps: Difference[];
}

/**
 * The language pages' tables against the compiler: each code exists, each
 * refused sample fails with its code, each accepted one compiles, each case
 * exists, and each known gap names a case.
 */
export function checkLanguage(
  data: LanguageData = { features, leftOut, differences, knownGaps },
  cases: Set<string> = e2eCases(),
  compile: (sample: Sample) => string[] = codesOf,
): string[] {
  const problems: string[] = [];
  const known = new Set<string>(Object.values(Codes));
  const rows: { at: string; cases?: string[]; refused?: Refusal[]; accepted?: Sample[] }[] = [
    ...data.features.map((f) => ({ at: `At a glance › ${f.feature}`, ...f })),
    ...data.leftOut.map((f) => ({ at: `Why a subset › ${f.feature}`, ...f })),
    ...data.differences.flatMap((s) => s.rows.map((r) => ({ at: `${s.title} › ${r.js}`, ...r }))),
    ...data.knownGaps.map((r) => ({ at: `Known gaps › ${r.js}`, ...r })),
  ];
  for (const { at, cases: named = [], refused = [], accepted = [] } of rows) {
    for (const c of named) if (!cases.has(c)) problems.push(`language: ${at}: no e2e case ${c}`);
    for (const { code, sample } of refused) {
      if (!known.has(code)) {
        problems.push(`language: ${at}: ${code} is not a code in codes.ts`);
        continue;
      }
      const got = compile(sample);
      if (!got.includes(code))
        problems.push(
          `language: ${at}: a sample should fail with ${code}, but ${got.length ? `gave ${[...new Set(got)].join(", ")}` : "it compiled"}`,
        );
    }
    for (const sample of accepted) {
      const got = compile(sample);
      if (got.length)
        problems.push(`language: ${at}: a sample should compile, but gave ${got.join(", ")}`);
    }
  }
  for (const gap of data.knownGaps)
    if (!gap.cases.length)
      problems.push(
        `language: Known gaps › ${gap.js}: a known gap names the e2e cases that test the code around it`,
      );
  return problems;
}
