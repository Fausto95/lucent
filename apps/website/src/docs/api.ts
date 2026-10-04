/**
 * What the API pages show of a declaration file's exports, as
 * scripts/website/declarations.ts reads them (src/generated/api.ts).
 */
export interface Member {
  name: string;
  signature: string;
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
}

export interface ModuleDeclarations {
  /** The file's opening comment says `@experimental`. */
  experimental: boolean;
  declarations: Declaration[];
}
