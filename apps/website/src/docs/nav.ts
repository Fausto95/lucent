import type { DocGroup, DocPage } from "./types";
import { page as introduction } from "./pages/introduction";
import { page as gettingStarted } from "./pages/getting-started";
import { page as gettingStartedExpo } from "./pages/getting-started-expo";
import { page as howItWorks } from "./pages/how-it-works";
import { page as comparison } from "./pages/comparison";
import { page as status } from "./pages/status";
import { page as language } from "./pages/language/overview";
import { page as types } from "./pages/language/types";
import { page as functions } from "./pages/language/functions";
import { page as classes } from "./pages/language/classes";
import { page as generics } from "./pages/language/generics";
import { page as async } from "./pages/language/async";
import { page as errors } from "./pages/language/errors";
import { page as modules } from "./pages/language/modules";
import { page as differences } from "./pages/language/differences";
import { page as diagnostics } from "./pages/language/diagnostics";
import { page as exportsPage } from "./pages/boundary/exports";
import { page as conversions } from "./pages/boundary/conversions";
import { page as callbacks } from "./pages/boundary/callbacks";
import { page as identity } from "./pages/boundary/identity";
import { page as boundaryErrors } from "./pages/boundary/errors";
import { page as cli } from "./pages/reference/cli";
import { page as metro } from "./pages/reference/metro";
import { page as expo } from "./pages/reference/expo";
import { page as core } from "./pages/reference/core";
import { page as platformApis } from "./pages/platform-apis";

/** Sidebar order is reading order; prev/next follow it. */
export const docsGroups: DocGroup[] = [
  { label: "Guide", pages: [introduction, gettingStarted, gettingStartedExpo, howItWorks, comparison, status] },
  {
    label: "Language",
    pages: [language, types, functions, classes, generics, async, errors, modules, differences, diagnostics],
  },
  { label: "JS ↔ native boundary", pages: [exportsPage, conversions, callbacks, identity, boundaryErrors] },
  { label: "Reference", pages: [cli, metro, expo, core] },
  { label: "Platform APIs", pages: [platformApis] },
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
