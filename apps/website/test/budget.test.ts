import { describe, expect, it } from "vite-plus/test";
import { checkBudgets } from "../../../scripts/website/budget.ts";
import type { CheckedPage } from "../../../scripts/website/pages.ts";

const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");

const page = (kind: CheckedPage["kind"], n: number): CheckedPage => ({
  href: `/docs/${kind}/`,
  kind,
  title: "",
  description: "",
  blocks: [{ kind: "p", text: words(n) }],
});

describe("length budgets", () => {
  it("hold guides to 400 words and explanations to 800", () => {
    expect(checkBudgets([page("guide", 400), page("explanation", 800)])).toEqual([]);
    expect(checkBudgets([page("guide", 401), page("explanation", 801)])).toEqual([
      "/docs/guide/ has 401 words (budget 400): split it",
      "/docs/explanation/ has 801 words (budget 800): split it",
    ]);
  });

  it("leave reference and internals pages unbounded", () => {
    expect(checkBudgets([page("reference", 5000), page("internals", 5000)])).toEqual([]);
  });
});
