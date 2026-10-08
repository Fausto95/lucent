import { describe, expect, it } from "vite-plus/test";
import { checkLanguage, type LanguageData } from "../../../scripts/website/language.ts";

const empty: LanguageData = { features: [], leftOut: [], differences: [], knownGaps: [] };
const gap = { js: "JS does this.", lucent: "Lucent does that.", why: "Not yet.", cases: [] };

describe("the language pages' tables", () => {
  it("match the compiler and the e2e cases", () => {
    expect(checkLanguage()).toEqual([]);
  }, 60_000);

  it("fail when a known gap names no case", () => {
    expect(checkLanguage({ ...empty, knownGaps: [gap] }, new Set(), () => [])).toEqual([
      "language: Known gaps › JS does this.: a known gap names the e2e cases that test the code around it",
    ]);
  });

  it("fail when a case doesn't exist", () => {
    expect(
      checkLanguage(
        { ...empty, knownGaps: [{ ...gap, cases: ["nope"] }] },
        new Set(["strings"]),
        () => [],
      ),
    ).toEqual(["language: Known gaps › JS does this.: no e2e case nope"]);
  });

  it("fail when a refused sample compiles, or fails with another code", () => {
    const data: LanguageData = {
      ...empty,
      features: [
        {
          feature: "Decorators",
          refused: [{ code: "LUCENT1005", sample: "@d class C {}" }],
        },
      ],
    };
    expect(checkLanguage(data, new Set(), () => [])).toEqual([
      "language: At a glance › Decorators: a sample should fail with LUCENT1005, but it compiled",
    ]);
    expect(checkLanguage(data, new Set(), () => ["LUCENT2001"])).toEqual([
      "language: At a glance › Decorators: a sample should fail with LUCENT1005, but gave LUCENT2001",
    ]);
  });

  it("fail when a code isn't one of codes.ts, or an accepted sample doesn't compile", () => {
    const data: LanguageData = {
      ...empty,
      features: [
        {
          feature: "Rest parameters",
          refused: [{ code: "LUCENT9999", sample: "" }],
          accepted: ["export function f(...xs: number[]): number { return xs.length; }"],
        },
      ],
    };
    expect(checkLanguage(data, new Set(), () => ["LUCENT2002"])).toEqual([
      "language: At a glance › Rest parameters: LUCENT9999 is not a code in codes.ts",
      "language: At a glance › Rest parameters: a sample should compile, but gave LUCENT2002",
    ]);
  });
});
