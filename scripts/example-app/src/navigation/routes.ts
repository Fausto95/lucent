export type Section = "examples" | "lab";

export type Route =
  | { readonly screen: "home"; readonly section: Section }
  | { readonly screen: "demo"; readonly id: string }
  | { readonly screen: "lab"; readonly id: string };

/** The screens a route may name. */
export interface RouteCatalog {
  readonly demos: readonly string[];
  readonly lab: readonly string[];
}

export const HOME: Route = { screen: "home", section: "examples" };

/** Each section's screens, in the order a bare name is looked up. */
const SECTIONS = [
  { section: "lab", screen: "lab", ids: (c: RouteCatalog) => c.lab },
  { section: "examples", screen: "demo", ids: (c: RouteCatalog) => c.demos },
] as const;

const SCHEME = /^[a-z][a-z\d+.-]*:\/\//;

/**
 * The route a deep link (`lucentbare://lab/tests`), a path (`lab/tests`) or a
 * bare screen name (`tests`, as `-lucentTab tests` gives it) names, or null.
 */
export function parseRoute(input: string, catalog: RouteCatalog): Route | null {
  const parts = input
    .trim()
    .toLowerCase()
    .replace(SCHEME, "")
    .replace(/[?#].*$/, "")
    .split("/")
    .filter((part) => part !== "");

  const [first, second] = parts;

  if (first === undefined) return HOME;

  if (parts.length > 2) return null;

  const home = SECTIONS.find((s) => s.section === first);

  if (second === undefined && home) return { screen: "home", section: home.section };

  const candidates = second === undefined ? SECTIONS : home ? [home] : [];

  const id = second ?? first;

  const match = candidates.find((s) => s.ids(catalog).includes(id));

  return match ? { screen: match.screen, id } : null;
}

/** The home section a demo or Lab screen belongs to. */
function sectionOf(route: Exclude<Route, { screen: "home" }>): Section {
  return SECTIONS.find((s) => s.screen === route.screen)!.section;
}

/** The path of a route: what follows `scheme://` in its deep link. */
export function routePath(route: Route): string {
  return route.screen === "home" ? route.section : `${sectionOf(route)}/${route.id}`;
}

/** Where back leads: the home section the screen belongs to; null from home. */
export function parentRoute(route: Route): Route | null {
  return route.screen === "home" ? null : { screen: "home", section: sectionOf(route) };
}
