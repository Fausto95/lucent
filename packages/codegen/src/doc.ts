/**
 * A tree of emitted lines whose indentation is structural.
 *
 * Emitters build a `Doc` and let `render` decide depth, so no call site
 * hardcodes a prefix and no fragment has to be trusted to arrive at the depth
 * its author assumed. Nesting that is not expressed in the tree cannot be
 * mis-indented, and brace balance follows from `block` rather than from
 * conditionally pushing an opening and a closing line.
 */
export type Doc =
  | string
  | readonly Doc[]
  | { readonly kind: "block"; readonly open: string; readonly body: Doc; readonly close: string }
  | { readonly kind: "indent"; readonly body: Doc }
  | { readonly kind: "blank" };

export interface RenderOptions {
  /** One level of indentation. Two spaces matches both generated languages. */
  indent?: string;
}

/** One empty line. Renders with no trailing whitespace at any depth. */
export const blank: Doc = { kind: "blank" };

/** `open`, an indented `body`, then `close` — the shape of every brace in both languages. */
export const block = (open: string, body: Doc, close = "}"): Doc => ({ kind: "block", open, body, close });

/** Shifts `body` one level without introducing delimiters. */
export const indent = (body: Doc): Doc => ({ kind: "indent", body });

/**
 * Joins entries with one blank line between them, and none at either end.
 * Empty entries are dropped, so an absent optional section leaves no gap.
 */
export const sections = (entries: readonly Doc[]): Doc => {
  const present = entries.filter((entry) => !isEmpty(entry));
  return present.flatMap((entry, i) => (i === 0 ? [entry] : [blank, entry]));
};

/** Joins entries with `separator` between them. */
export const join = (entries: readonly Doc[], separator: Doc): Doc =>
  entries.flatMap((entry, i) => (i === 0 ? [entry] : [separator, entry]));

export function render(doc: Doc, options: RenderOptions = {}): string {
  const unit = options.indent ?? "  ";
  const out: string[] = [];
  emit(doc, 0, unit, out);
  return out.length === 0 ? "" : out.join("\n") + "\n";
}

function emit(doc: Doc, depth: number, unit: string, out: string[]): void {
  if (typeof doc === "string") {
    // A fragment assembled elsewhere keeps its own relative shape but is
    // re-anchored here, so its depth never depends on where it was built.
    for (const line of doc.split("\n")) out.push(line === "" ? "" : unit.repeat(depth) + line);
    return;
  }
  if (Array.isArray(doc)) {
    for (const child of doc) emit(child, depth, unit, out);
    return;
  }
  const node = doc as Exclude<Doc, string | readonly Doc[]>;
  switch (node.kind) {
    case "blank":
      out.push("");
      return;
    case "indent":
      emit(node.body, depth + 1, unit, out);
      return;
    case "block":
      emit(node.open, depth, unit, out);
      emit(node.body, depth + 1, unit, out);
      emit(node.close, depth, unit, out);
      return;
  }
}

/** True when a doc contributes no lines, so `sections` can skip it. */
function isEmpty(doc: Doc): boolean {
  if (typeof doc === "string") return false;
  if (Array.isArray(doc)) return doc.every(isEmpty);
  return false;
}
