// The failed tests of a run, as annotations a pull request shows.
import { describe, expect, it } from "vite-plus/test";
import { annotations, failures } from "./test-failures.ts";

const report = {
  testResults: [
    {
      name: "/repo/packages/a/test/a.test.ts",
      status: "failed",
      assertionResults: [
        { fullName: "a > passes", status: "passed" },
        {
          fullName: "a > fails",
          status: "failed",
          failureMessages: ["\x1b[31mexpected 1\x1b[39m\n50% off"],
        },
        { fullName: "a > fails, again: twice", status: "failed", failureMessages: ["expected 2"] },
      ],
    },
    {
      name: "/repo/packages/b/test/b.test.ts",
      status: "failed",
      message: "Cannot find module",
      assertionResults: [],
    },
    { name: "/repo/packages/c/test/c.test.ts", status: "passed", assertionResults: [] },
  ],
};

describe("a run's failed tests", () => {
  it("are each failed test, and each file that failed without one", () => {
    expect(failures(report, "/repo")).toEqual([
      {
        file: "packages/a/test/a.test.ts",
        test: "a > fails",
        message: "\x1b[31mexpected 1\x1b[39m\n50% off",
      },
      { file: "packages/a/test/a.test.ts", test: "a > fails, again: twice", message: "expected 2" },
      { file: "packages/b/test/b.test.ts", message: "Cannot find module" },
    ]);
  });

  it("are annotated: a list, then each file's first failure, escaped", () => {
    expect(annotations(failures(report, "/repo"))).toEqual([
      "::error title=3 tests failed::packages/a/test/a.test.ts > a > fails%0Apackages/a/test/a.test.ts > a > fails, again: twice%0Apackages/b/test/b.test.ts (did not run)",
      "::error file=packages/a/test/a.test.ts,title=a > fails::expected 1%0A50%25 off",
      "::error file=packages/b/test/b.test.ts,title=did not run::Cannot find module",
    ]);
    expect(annotations([])).toEqual([]);
  });
});
