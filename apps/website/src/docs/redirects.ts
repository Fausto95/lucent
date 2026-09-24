/**
 * Retired docs slugs → their replacement. Old links keep working: the docs
 * route follows these before reporting a page as missing, and
 * scripts/website.ts checks that every target exists.
 */
export const docsRedirects: Record<string, string> = {
  "getting-started": "install",
  "getting-started-expo": "install",
  "what-you-can-build": "status",
  examples: "language",
  "language/functions-and-control-flow": "language/functions",
  "language/async-and-errors": "language/async",
  "language/unions": "language/types",
  "language/native-classes": "language/classes",
  "language/events": "boundary/callbacks",
  "language/native-views": "status",
  "language/threads": "language/async",
  "language/platform-and-capabilities": "platform-apis",
  "api/packages": "platform-apis",
  "api/types": "boundary/conversions",
  "api/objects": "boundary/identity",
  "api/events": "boundary/callbacks",
  "api/ui": "platform-apis",
  "api/std": "reference/core",
  "api/config": "reference/cli",
  "api/runtime": "reference/core",
  "api/cli": "reference/cli",
  "api/integrations": "reference/metro",
  "api/library-manifest": "platform-apis",
};
