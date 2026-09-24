import { createRootRoute } from "@tanstack/react-router";
import { NotFound } from "../components/NotFound";
import { SiteLayout } from "../components/SiteLayout";

export const rootRoute = createRootRoute({ component: SiteLayout, notFoundComponent: NotFound });
