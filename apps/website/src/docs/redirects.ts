/**
 * The docs URLs the site used to serve, each to the page that replaced it.
 * Published CLIs (`lucent explain`, `lucent init`), READMEs on npm and
 * links elsewhere still point at them, so each keeps working as a
 * permanent redirect: scripts/website.ts writes them into vercel.json and
 * checks that every target is a page of the sidebar.
 *
 * The keys are slugs under /docs/ the site served:
 *   - the Starlight site (2026-10-01 to 2026-10-06), from its sidebar and
 *     src/content/docs/docs/ before the Docusaurus rewrite (81c5bb2a);
 *   - the retired slugs that site already redirected (its
 *     src/docs/redirects.ts), now sent straight to the current page.
 * A page that moves or goes adds its old slug here.
 */
export const docsRedirects: Record<string, string> = {
  // The Starlight site's pages.
  install: "guides/install",
  "first-module": "guides/first-module",
  "tutorial/1-shared-logic": "guides/first-module",
  "tutorial/2-data": "guides/share-data-with-javascript",
  "tutorial/3-async": "guides/run-work-off-the-js-thread",
  "tutorial/4-errors": "guides/throw-and-handle-errors",
  "tutorial/5-platform-code": "guides/platform-code",
  "tutorial/6-callbacks": "guides/implement-a-delegate",
  "tutorial/7-permissions": "guides/ask-for-a-permission",
  "tutorial/8-publish": "packages/publish-a-package",
  "how-it-works": "architecture",
  "how-it-works/calls": "architecture/boundary",
  "how-it-works/platform-calls": "architecture/sdk-bindings",
  "thinking/three-places": "api/language/boundary",
  "thinking/boundary-first": "architecture/api-design",
  "thinking/shared-first": "guides/share-code-between-platforms",
  "thinking/threads": "architecture/threads",
  "thinking/memory": "architecture/memory",
  "thinking/typescript": "api/language/differences",
  "coming-from-native": "guides/coming-from-swift-or-kotlin",
  "guides/publish-a-library": "packages/publish-a-package",
  "guides/use-a-library": "guides/use-a-lucent-package",
  "guides/debug-a-crash": "guides/symbolicate-a-native-crash",
  "guides/upgrade": "guides/upgrade-lucent",
  "reference/language": "api/language",
  "reference/built-ins": "api/language/built-ins",
  "reference/boundary-types": "api/language/boundary",
  "reference/platform-types": "api/ios-sdk",
  "reference/modules": "api",
  "reference/cli": "api/cli",
  "reference/lucent-json": "packages/lucent-json",
  "reference/metro-and-expo": "api/integrations",
  "reference/diagnostics": "api/diagnostics",
  "reference/compatibility": "api/compatibility",
  examples: "guides/port-an-expo-module",
  "examples/clipboard": "guides/examples/clipboard",
  "examples/location": "guides/examples/location",
  "examples/netinfo": "guides/examples/netinfo",
  "examples/local-authentication": "guides/examples/local-authentication",
  "examples/secure-store": "packages/examples/secure-store",
  "examples/haptics": "packages/examples/haptics",
  comparison: "guides/comparison",
  faq: "guides/faq",
  roadmap: "releases/roadmap",

  // Slugs the Starlight site already redirected.
  "getting-started": "guides/install",
  "getting-started-expo": "guides/install",
  "what-you-can-build": "releases/roadmap",
  status: "releases/roadmap",
  "platform-apis": "guides/platform-code",
  language: "api/language",
  "language/functions-and-control-flow": "api/language/statements",
  "language/async-and-errors": "api/language/concurrency",
  "language/unions": "api/language/types",
  "language/native-classes": "api/language/types",
  "language/events": "guides/accept-a-js-callback",
  "language/native-views": "guides/views",
  "language/threads": "architecture/threads",
  "language/platform-and-capabilities": "guides/platform-code",
  "language/types": "api/language/types",
  "language/functions": "api/language/statements",
  "language/classes": "api/language/types",
  "language/generics": "api/language/types",
  "language/async": "api/language/concurrency",
  "language/modules": "api/language/modules",
  "language/differences": "api/language/differences",
  "language/diagnostics": "api/diagnostics",
  "language/errors": "guides/throw-and-handle-errors",
  "api/packages": "guides/platform-code",
  "api/types": "api/language/boundary",
  "api/objects": "api/language/boundary",
  "api/events": "guides/accept-a-js-callback",
  "api/ui": "guides/views",
  "api/std": "api/lucent-core",
  "api/config": "packages/lucent-json",
  "api/runtime": "api/lucent-core",
  "api/library-manifest": "packages/lucent-json",
  "boundary/exports": "architecture/boundary",
  "boundary/conversions": "api/language/boundary",
  "boundary/identity": "api/language/boundary",
  "boundary/callbacks": "guides/accept-a-js-callback",
  "boundary/errors": "guides/throw-and-handle-errors",
  "reference/metro": "api/integrations",
  "reference/expo": "api/integrations",
  "reference/core": "api/lucent-core",
};

/** URLs from before the site moved its docs under /docs/. */
export const rootRedirects: Record<string, string> = {
  "/language/": "/docs/api/language/",
  "/get-started/": "/docs/guides/install/",
};

/**
 * The docs URLs that published versions of @lucent-lang/lucent print or
 * ship in their README (0.0.4 to 0.2.0), found with
 * `grep -o 'lucent-lang.dev/[^"]*'` in each tarball. Each must redirect to
 * a page or be one.
 */
export const publishedUrls: string[] = [
  "/docs/",
  "/docs/install/",
  "/docs/examples/",
  "/docs/how-it-works/",
  "/docs/guides/call-an-ios-api/",
  "/docs/reference/diagnostics/",
  "/docs/reference/language/",
  "/docs/tutorial/1-shared-logic/",
];

export interface VercelRedirect {
  source: string;
  destination: string;
  permanent: true;
}

/**
 * vercel.json's redirects: each old URL to its page, as a 308, which keeps
 * the URL's #fragment, so /docs/reference/diagnostics/#lucent1001 lands on
 * that code. vercel.json's `trailingSlash` first sends /docs/install to
 * /docs/install/, so each source ends with a slash.
 */
export function vercelRedirects(): VercelRedirect[] {
  const entries: [string, string][] = [
    ...Object.entries(docsRedirects).map(([from, to]): [string, string] => [
      `/docs/${from}/`,
      to ? `/docs/${to}/` : "/docs/",
    ]),
    ...Object.entries(rootRedirects),
  ];
  return entries.map(([from, to]) => ({
    source: from,
    destination: to,
    permanent: true,
  }));
}
