/** One sidebar per docs section, from src/docs/nav.ts. */
import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";
import { sidebarsOf } from "./src/docs/nav.ts";

const sidebars: SidebarsConfig = sidebarsOf();

export default sidebars;
