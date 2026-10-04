import { describe, expect, it } from "vite-plus/test";
import { templatePages } from "../../../scripts/website/templates.ts";
import type { DocTemplate } from "../src/docs/types.ts";

const page = (title: string): DocTemplate => ({
  frontmatter: { title, description: "A page.", kind: "reference" },
  blocks: [{ kind: "p", text: title }],
});

describe("templatePages", () => {
  it("writes a plain template's page at the template's path", () => {
    expect(templatePages({ "api/cli.ts": page("CLI") })).toEqual({
      "api/cli": { file: "api/cli.ts", ...page("CLI") },
    });
  });

  it("writes each page a template lists, at the slug it names", () => {
    const modules = {
      "api/modules.ts": {
        pages: { "api/lucent-core": page("core"), "api/globals": page("globals") },
      },
    };

    expect(templatePages(modules)).toEqual({
      "api/lucent-core": { file: "api/modules.ts", ...page("core") },
      "api/globals": { file: "api/modules.ts", ...page("globals") },
    });
  });

  it("fails when two templates write one page", () => {
    expect(() =>
      templatePages({
        "api/cli.ts": page("CLI"),
        "api/tools.ts": { pages: { "api/cli": page("CLI again") } },
      }),
    ).toThrow("api/cli is written by both api/cli.ts and api/tools.ts");
  });
});
