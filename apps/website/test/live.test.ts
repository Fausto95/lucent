import { describe, expect, it } from "vite-plus/test";
import { checkLive, siteUrlsIn, type LiveFetch } from "../../../scripts/website/live.ts";

const site: Record<string, { status: number; location?: string; body?: string }> = {
  "https://lucent-lang.dev/docs/": { status: 200, body: "<h1>Lucent</h1>" },
  "https://lucent-lang.dev/docs/install/": { status: 308, location: "/docs/guides/install/" },
  "https://lucent-lang.dev/docs/guides/install/": { status: 200, body: '<h2 id="expo">Expo</h2>' },
  "https://lucent-lang.dev/docs/gone/": { status: 404 },
  "https://lucent-lang.dev/docs/away/": { status: 301, location: "https://example.com/" },
  "https://lucent-lang.dev/docs/loop/": { status: 308, location: "/docs/loop/" },
};
const fake: LiveFetch = async (url) => {
  const r = site[url];
  if (!r) throw new Error("connection refused");
  return { status: r.status, ...(r.location ? { location: r.location } : {}), body: r.body ?? "" };
};
const check = (hrefs: string[]) => checkLive("https://lucent-lang.dev", hrefs, fake);

describe("the deployed site's URLs", () => {
  it("pass when they answer with a page, through its redirects, with the fragment's id", async () => {
    expect(await check(["/docs/", "/docs/install/", "/docs/install/#expo"])).toEqual([]);
  });

  it("report a missing page, a missing id, a redirect off the site and a loop", async () => {
    expect(
      await check(["/docs/gone/", "/docs/install/#eas", "/docs/away/", "/docs/loop/", "/x/"]),
    ).toEqual([
      "/docs/gone/: https://lucent-lang.dev/docs/gone/ answered 404",
      "/docs/install/#eas: https://lucent-lang.dev/docs/guides/install/ has no element with id eas",
      "/docs/away/: redirects off the site, to https://example.com/",
      "/docs/loop/: more than 5 redirects",
      "/x/: https://lucent-lang.dev/x/ failed: connection refused",
    ]);
  });

  it("are read from READMEs as path and fragment", () => {
    expect(
      siteUrlsIn(
        "See [docs](https://lucent-lang.dev/docs/guides/port-an-expo-module/#example-ports). Or https://lucent-lang.dev/docs/.",
      ),
    ).toEqual(["/docs/guides/port-an-expo-module/#example-ports", "/docs/"]);
  });
});
