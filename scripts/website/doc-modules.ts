/// <reference types="vite/client" />
/**
 * Every docs page module, keyed by its path under src/docs/. Loaded through
 * Vite (pages.ts), because pages import the website's modules the way the
 * website does, without extensions, which Node's resolver doesn't accept.
 */
import type { DocModule } from "../../apps/website/src/docs/types.ts";

const modules = import.meta.glob<DocModule>("../../apps/website/src/docs/pages/**/*.ts", { eager: true });

export const docModules: Record<string, DocModule> = Object.fromEntries(Object.entries(modules).map(([file, mod]) => [file.replace("../../apps/website/src/docs/", ""), mod]));
