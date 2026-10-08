import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { checkRedirects, vercelJson } from "../../../scripts/website/redirects.ts";
import { docsSlugs } from "../src/docs/nav.ts";
import { docsRedirects, publishedUrls, vercelRedirects } from "../src/docs/redirects.ts";

const root = path.resolve(import.meta.dirname, "../../..");

describe("the old docs URLs", () => {
  it("each redirect to a page of the sidebar", () => {
    expect(checkRedirects(docsSlugs)).toEqual([]);
  });

  it("cover every URL a published CLI or README links to", () => {
    const redirected = new Set(Object.keys(docsRedirects).map((s) => `/docs/${s}/`));
    const pages = new Set(docsSlugs.map((s) => (s ? `/docs/${s}/` : "/docs/")));
    expect(publishedUrls.filter((u) => !pages.has(u) && !redirected.has(u))).toEqual([]);
  });

  it("report a redirect to a page that doesn't exist, and one that hides a page", () => {
    expect(checkRedirects(docsSlugs.filter((s) => s !== "guides/install"))).toContain(
      "redirect /docs/install/ → /docs/guides/install/, which is not a page",
    );
    expect(checkRedirects([...docsSlugs, "install"])).toContain(
      "redirect /docs/install/ is a page: remove it from src/docs/redirects.ts",
    );
  });

  it("are in vercel.json as permanent redirects", () => {
    const file = fs.readFileSync(path.join(root, "vercel.json"), "utf8");
    expect(vercelJson(file)).toBe(file);
    expect(vercelRedirects()).toContainEqual({
      source: "/docs/reference/diagnostics/",
      destination: "/docs/api/diagnostics/",
      permanent: true,
    });
  });
});
