/// <reference types="vite/client" />
/**
 * Every template module (src/docs/templates/), keyed by its path there.
 * Loaded through Vite (pages.ts), because templates import the website's
 * modules the way the website does, without extensions, which Node's
 * resolver doesn't accept.
 */
import type { TemplateModule } from "./templates.ts";

const templates = import.meta.glob<TemplateModule>(
  "../../apps/website/src/docs/templates/**/*.ts",
  { eager: true },
);

export const templateModules: Record<string, TemplateModule> = Object.fromEntries(
  Object.entries(templates).map(([file, mod]) => [
    file.replace("../../apps/website/src/docs/templates/", ""),
    mod,
  ]),
);
