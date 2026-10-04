/** Starlight route middleware: each docs page sees only its own section (sections.ts). */
import { defineRouteMiddleware } from "@astrojs/starlight/route-data";
import { sectionRoute } from "./sections.ts";

export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute;
  Object.assign(route, sectionRoute(route));
});
