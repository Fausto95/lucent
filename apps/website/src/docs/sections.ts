/**
 * Narrows Starlight's route to the page's section: its sidebar shows only
 * that section's groups, and Previous and Next stay inside it. Starlight
 * computes both over the whole sidebar before route middleware runs
 * (route-data.ts applies this).
 */
import type { StarlightRouteData } from "@astrojs/starlight/route-data";
import { type DocSection, docsSections, locate, slugOfId } from "./nav.ts";

type Entry = StarlightRouteData["sidebar"][number];
type Link = Extract<Entry, { type: "link" }>;

/** What sectionRoute reads of a route. */
export interface SectionRouteInput {
  id: string;
  sidebar: Entry[];
  pagination: StarlightRouteData["pagination"];
  /** The frontmatter: a page that sets prev or next keeps the link Starlight made for it. */
  entry: { data: { prev?: unknown; next?: unknown } };
}

const linksOf = (entries: Entry[]): Link[] =>
  entries.flatMap((e) => (e.type === "link" ? [e] : linksOf(e.entries)));

/** Whether a sidebar entry is the current page or holds it: its group starts expanded. */
export const holdsCurrent = (entry: Entry): boolean =>
  entry.type === "link" ? entry.isCurrent : entry.entries.some(holdsCurrent);

/** The page's section's sidebar and pagination; {} for pages outside the docs. */
export function sectionRoute(
  route: SectionRouteInput,
  sections: DocSection[] = docsSections,
): Partial<Pick<StarlightRouteData, "sidebar" | "pagination">> {
  const slug = slugOfId(route.id);
  if (slug === undefined) return {};
  const at = locate(slug, sections);
  if (!at) throw new Error(`/docs/${slug}/ is not in the sidebar (src/docs/nav.ts)`);
  const group = route.sidebar[at.sectionIndex];
  if (group?.type !== "group" || group.label !== at.section.label)
    throw new Error(
      `Starlight's sidebar entry ${at.sectionIndex} should be the ${at.section.label} section`,
    );

  const links = linksOf(group.entries);
  const current = links.findIndex((l) => l.isCurrent);
  const { prev, next } = route.entry.data;
  return {
    sidebar: group.entries,
    pagination: {
      prev: prev === undefined ? links[current - 1] : route.pagination.prev,
      next:
        next === undefined ? (current < 0 ? undefined : links[current + 1]) : route.pagination.next,
    },
  };
}
