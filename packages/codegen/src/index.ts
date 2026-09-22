/**
 * Target-language-agnostic emission helpers. A leaf package: it knows nothing
 * about the IR, the backends, or the hosts, so both may depend on it.
 */
export { blank, block, indent, join, render, sections, type Doc, type RenderOptions } from "./doc.ts";
export { fillNative, type NativeFill } from "./template.ts";
