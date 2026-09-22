import { createRequire } from "node:module";

/** Resolved at runtime so the bundled bin and the tsx entry read the same package.json. */
const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

export const CLI_VERSION: string = pkg.version;

export const REPOSITORY_URL = "https://github.com/Fausto95/lucent";
export const DOCS_URL = `${REPOSITORY_URL}/blob/main/docs`;
