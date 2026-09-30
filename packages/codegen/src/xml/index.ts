/** XML documents (the Android library manifest), as plain data and a printer. */

export interface Element {
  name: string;
  attributes: Record<string, string>;
  /** Absent: an empty element, `<name />`; present, even empty: `<name>…</name>`. */
  children?: Element[];
}

export interface Document {
  /** A comment after the declaration, saying where the file comes from. */
  comment?: string;
  root: Element;
}

export const element = (
  name: string,
  attributes: Record<string, string> = {},
  children?: Element[],
): Element => (children ? { name, attributes, children } : { name, attributes });

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

function print(e: Element, indent: string): string[] {
  const attrs = Object.entries(e.attributes)
    .map(([k, v]) => ` ${k}="${v.replace(/[&<>"]/g, (c) => ESCAPES[c]!)}"`)
    .join("");
  if (!e.children) return [`${indent}<${e.name}${attrs} />`];
  return [
    `${indent}<${e.name}${attrs}>`,
    ...e.children.flatMap((c) => print(c, `${indent}  `)),
    `${indent}</${e.name}>`,
  ];
}

export function printDocument(d: Document): string {
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    ...(d.comment ? [`<!-- ${d.comment} -->`] : []),
    ...print(d.root, ""),
  ];
  return `${lines.join("\n")}\n`;
}
