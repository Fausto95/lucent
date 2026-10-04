/**
 * What the API pages show of a declaration file's exports, as
 * scripts/website/declarations.ts reads them (src/generated/api.ts).
 */
export interface Member {
  name: string;
  signature: string;
  doc: string;
}

/** A function's parameter, as its signature and its @param tag give it. */
export interface Param {
  name: string;
  type: string;
  optional: boolean;
  doc: string;
}

export interface Declaration {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "const" | "namespace" | "enum";
  /** As written, without `export declare`, comments or brands. */
  signature: string;
  /** The doc comment's paragraphs, each on one line. */
  doc: string[];
  /** The doc comment's code blocks: whole modules, compiled as samples. */
  examples: string[];
  members: Member[];
  /** A function's parameters; none for other declarations. */
  params: Param[];
}

export interface ModuleDeclarations {
  /** The file's opening comment says `@experimental`. */
  experimental: boolean;
  declarations: Declaration[];
}
