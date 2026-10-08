// The same recursive shape, declared twice, is one native type.
interface TreeNode {
  value: number;
  children: TreeNode[];
}
type Tree = { value: number; children: Tree[] };

function size(t: TreeNode): number {
  return 1 + t.children.reduce((a, c) => a + size(c), 0);
}

export function treeSize(t: Tree): number {
  return size(t);
}

export function grow(t: TreeNode): Tree {
  return { value: t.value + 1, children: t.children.map(grow) };
}

interface ListA {
  v: number;
  next?: ListA;
}
type ListB = { v: number; next?: ListB };

function lenA(l: ListA): number {
  return l.next ? 1 + lenA(l.next) : 1;
}

export function lenB(l: ListB): number {
  return lenA(l);
}

// Mutual recursion and self recursion with the same field names are different shapes.
interface Even {
  n: number;
  other?: Odd;
}
interface Odd {
  n: string;
  other?: Even;
}
interface Self {
  n: number;
  other?: Self;
}

export function evens(e: Even): string {
  return `${e.n}/${e.other?.n ?? "-"}/${e.other?.other?.n ?? "-"}`;
}

export function selfs(s: Self): string {
  return `${s.n}/${s.other?.n ?? "-"}/${s.other?.other?.n ?? "-"}`;
}

// Recursion through a union and a map.
type Json = { tag: "num"; n: number } | { tag: "list"; items: Json[] };
type Doc = { name: string; kids: Map<string, Doc> | null };

export function sum(j: Json): number {
  return j.tag === "num" ? j.n : j.items.reduce((a, c) => a + sum(c), 0);
}

export function names(d: Doc): string {
  const out = [d.name];
  if (d.kids) for (const k of d.kids.values()) out.push(names(k));
  return out.join(",");
}
