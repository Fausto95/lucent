/// <reference types="vite/client" />
/**
 * Every reference-page template, keyed by its slug. Loaded through Vite
 * (pages.ts), because templates import the website's modules the way the
 * website does, without extensions, which Node's resolver doesn't accept.
 */
import type { DocTemplate } from "../../apps/website/src/docs/types.ts";

const templates = import.meta.glob<DocTemplate>("../../apps/website/src/docs/templates/**/*.ts", {
  eager: true,
});

export const docTemplates: Record<string, DocTemplate> = Object.fromEntries(
  Object.entries(templates).map(([file, mod]) => [
    file.replace("../../apps/website/src/docs/templates/", "").replace(/\.ts$/, ""),
    mod,
  ]),
);
