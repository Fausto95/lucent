import type { DocGroup, DocPage } from "./types";
import { page as introduction } from "./pages/introduction";
import { page as whatYouCanBuild } from "./pages/what-you-can-build";
import { page as gettingStarted } from "./pages/getting-started";
import { page as howItWorks } from "./pages/how-it-works";
import { page as examples } from "./pages/examples";
import { page as language } from "./pages/language/overview";
import { page as functions } from "./pages/language/functions-and-control-flow";
import { page as asyncAndErrors } from "./pages/language/async-and-errors";
import { page as unions } from "./pages/language/unions";
import { page as nativeClasses } from "./pages/language/native-classes";
import { page as events } from "./pages/language/events";
import { page as nativeViews } from "./pages/language/native-views";
import { page as threads } from "./pages/language/threads";
import { page as platform } from "./pages/language/platform-and-capabilities";
import { page as diagnostics } from "./pages/language/diagnostics";
import { page as packages } from "./pages/api/packages";
import { page as apiTypes } from "./pages/api/types";
import { page as apiObjects } from "./pages/api/objects";
import { page as apiEvents } from "./pages/api/events";
import { page as apiUi } from "./pages/api/ui";
import { page as apiStd } from "./pages/api/std";
import { page as apiConfig } from "./pages/api/config";
import { page as apiRuntime } from "./pages/api/runtime";
import { page as apiCli } from "./pages/api/cli";
import { page as apiIntegrations } from "./pages/api/integrations";
import { page as apiLibraryManifest } from "./pages/api/library-manifest";

/** Sidebar order is reading order; prev/next follow it. */
export const docsGroups: DocGroup[] = [
  { label: "Guide", pages: [introduction, whatYouCanBuild, gettingStarted, howItWorks, examples] },
  {
    label: "Language",
    pages: [
      language,
      functions,
      asyncAndErrors,
      unions,
      nativeClasses,
      events,
      nativeViews,
      threads,
      platform,
      diagnostics,
    ],
  },
  {
    label: "API",
    pages: [
      packages,
      apiTypes,
      apiObjects,
      apiEvents,
      apiUi,
      apiStd,
      apiConfig,
      apiRuntime,
      apiCli,
      apiIntegrations,
      apiLibraryManifest,
    ],
  },
];

const flat = docsGroups.flatMap((group) => group.pages.map((page) => ({ page, group })));

export interface DocLookup {
  page: DocPage;
  group: DocGroup;
  previous?: DocPage;
  next?: DocPage;
}

export function findDocPage(slug: string): DocLookup | null {
  const index = flat.findIndex(({ page }) => page.slug === slug);
  if (index === -1) return null;
  const { page, group } = flat[index]!;
  return {
    page,
    group,
    ...(index > 0 ? { previous: flat[index - 1]!.page } : {}),
    ...(index < flat.length - 1 ? { next: flat[index + 1]!.page } : {}),
  };
}
