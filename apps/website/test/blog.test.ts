import { describe, expect, it } from "vite-plus/test";
import { checkPosts } from "../../../scripts/website/pages.ts";
import { formatDate, newestFirst } from "../src/blog/types.ts";

const post = (slug: string, date: string) => ({
  slug,
  date,
  title: slug,
  description: "A post.",
});

describe("blog posts", () => {
  it("pass with a title, a description and a real day", () => {
    expect(checkPosts([post("views", "2026-10-02"), post("modules", "2026-09-30")])).toEqual([]);
  });

  it("need a title and a description", () => {
    expect(checkPosts([{ ...post("views", "2026-10-02"), description: "" }])).toEqual([
      "/blog/views/ needs a title and a description in its frontmatter",
    ]);
  });

  it("are dated with a real day", () => {
    expect(checkPosts([post("modules", "30/09/2026"), post("views", "2026-02-30")])).toEqual([
      "/blog/modules/: 30/09/2026 is not a day (YYYY-MM-DD)",
      "/blog/views/: 2026-02-30 is not a day (YYYY-MM-DD)",
    ]);
  });

  it("are listed newest first", () => {
    const posts = [post("modules", "2026-09-30"), post("views", "2026-10-02")];

    expect(newestFirst(posts).map((p) => p.slug)).toEqual(["views", "modules"]);
  });

  it("show their date as the day it names", () => {
    expect(formatDate("2026-09-30")).toBe("September 30, 2026");
  });
});
