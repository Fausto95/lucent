import { describe, expect, it } from "vite-plus/test";
import { checkPosts } from "../../../scripts/website/pages.ts";
import { formatDate } from "../src/blog/types.ts";

const post = (slug: string, date: string) => ({ slug, date, title: slug, summary: "" });

describe("blog posts", () => {
  it("pass with a file each, real days, newest first", () => {
    const posts = [post("views", "2026-10-02"), post("modules", "2026-09-30")];

    expect(checkPosts(posts, ["views.ts", "modules.ts"])).toEqual([]);
  });

  it("need their file listed, and nothing else in the folder", () => {
    const problems = checkPosts([post("views", "2026-10-02")], ["draft.ts"]);

    expect(problems).toContain("src/blog/pages/draft.ts is not a post (src/blog/posts.ts)");
  });

  it("have one slug each", () => {
    const posts = [post("views", "2026-10-02"), post("views", "2026-09-30")];

    expect(checkPosts(posts, ["views.ts"])).toContain("two posts are /blog/views/");
  });

  it("are dated with a real day", () => {
    const posts = [post("modules", "30/09/2026"), post("views", "2026-02-30")];

    expect(checkPosts(posts, ["views.ts", "modules.ts"])).toEqual([
      "/blog/modules/: 30/09/2026 is not a day (YYYY-MM-DD)",
      "/blog/views/: 2026-02-30 is not a day (YYYY-MM-DD)",
    ]);
  });

  it("are listed newest first", () => {
    const posts = [post("modules", "2026-09-30"), post("views", "2026-10-02")];

    expect(checkPosts(posts, ["views.ts", "modules.ts"])).toEqual([
      "/blog/views/ is listed after an older post: list posts newest first",
    ]);
  });

  it("show their date as the day it names", () => {
    expect(formatDate("2026-09-30")).toBe("September 30, 2026");
  });
});
