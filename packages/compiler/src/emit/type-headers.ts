/**
 * The program's types, one header per group of them, so a native build
 * compiles again only the units that use a type whose shape changed.
 *
 * Each type's forward declaration, definition, JSON writer declarations
 * and inline JSON writers are in `lucent_app_<name>.h`, which first
 * includes the headers of the types it spells: its bases must be complete,
 * and its inline code writes and reads its fields' types. Types that spell
 * each other share a header (a strongly connected component), in the order
 * a single header defined them (structs, interfaces by depth, classes by
 * depth, generic classes; declarations before definitions, definitions
 * before inline code). `lucent_app.h` is the runtime's headers, and the
 * native objects' declarations of the classes that have them. A unit
 * includes the headers of the types its own code spells; a type it reaches
 * without spelling it (a field's, or a function's from another module) is
 * spelled where that field or function is declared, whose header the unit
 * includes. So adding, removing or changing a type changes the units that
 * spell it, and those including them, alone. JSON.parse's readers are
 * template specializations: `lucent_app_json.h` declares them (included
 * before any code that spells `jsonParse`), `lucent_app_json_read.h`
 * defines them.
 */
import { cpp } from "@lucent-lang/codegen";
import { identifiers, spelledIn } from "./macros.ts";

/**
 * One type: its definition, the declarations that follow every
 * definition (its JSON writers'), and its inline code (their definitions).
 */
export interface TypeItem {
  name: string;
  defs: cpp.Decl[];
  decls: cpp.Decl[];
  inline: cpp.Decl[];
}

export interface TypeHeaders {
  /** The group headers, and the JSON readers' two when there are readers. */
  files: Map<string, cpp.Decl[]>;
  /**
   * The includes a unit with code `decls` needs, past those `already`
   * (the units it includes) brings: its types' headers, then the JSON
   * readers' definitions where the code parses JSON. `prefix` leads each
   * path (a unit in a subdirectory).
   */
  includes(
    decls: readonly cpp.Decl[],
    already?: readonly cpp.Decl[],
    prefix?: string,
  ): { types: cpp.Decl[]; readers: cpp.Decl[] };
  /** Every header, for a unit that uses the whole program (the bindings). */
  all(prefix?: string): cpp.Decl[];
}

export const INDEX_HEADER = "lucent_app.h";
const READER_DECLS = "lucent_app_json.h";
const READER_DEFS = "lucent_app_json_read.h";

const spellsParse = (names: ReadonlySet<string>) => names.has("jsonParse");

/**
 * Groups `items` (in the single header's order) into headers. `forward`
 * declares each type; `app` wraps declarations in lucent_app's namespace;
 * `readers` are the JSON readers' declarations and definitions, in
 * namespace lucent.
 */
export function typeHeaders(
  items: readonly TypeItem[],
  forward: ReadonlyMap<string, cpp.Decl>,
  readers: { decls: cpp.Decl[]; defs: cpp.Decl[] },
  app: (body: cpp.Decl[]) => cpp.Decl,
): TypeHeaders {
  const index = new Map(items.map((t, i) => [t.name, i]));
  const spelled = items.map((t) =>
    identifiers(cpp.printDecls([...t.defs, ...t.decls, ...t.inline])),
  );
  const declared = (names: ReadonlySet<string>) =>
    [...names]
      .filter((n) => index.has(n))
      .sort((a, b) => index.get(a)! - index.get(b)!)
      .map((n) => forward.get(n)!);
  const mentions = items.map((_, i) =>
    [...spelled[i]!].flatMap((n) => {
      const j = index.get(n);
      return j === undefined || j === i ? [] : [j];
    }),
  );

  // Tarjan's strongly connected components; each one becomes a header.
  const group = new Array<number>(items.length).fill(-1);
  const groups: number[][] = [];
  {
    const low: number[] = [];
    const order: number[] = [];
    const stack: number[] = [];
    const onStack = new Set<number>();
    let next = 0;
    const visit = (v: number): void => {
      order[v] = low[v] = next++;
      stack.push(v);
      onStack.add(v);
      for (const w of mentions[v]!) {
        if (order[w] === undefined) {
          visit(w);
          low[v] = Math.min(low[v]!, low[w]!);
        } else if (onStack.has(w)) low[v] = Math.min(low[v]!, order[w]!);
      }
      if (low[v] === order[v]) {
        const members: number[] = [];
        let w: number;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          members.push(w);
        } while (w !== v);
        members.sort((a, b) => a - b);
        for (const m of members) group[m] = groups.length;
        groups.push(members);
      }
    };
    for (let i = 0; i < items.length; i++) if (order[i] === undefined) visit(i);
  }
  const headerOf = (g: number) => `lucent_app_${items[groups[g]![0]!]!.name}.h`;
  /** The groups a group spells, in the single header's order. */
  const deps = groups.map((members, g) =>
    [...new Set(members.flatMap((m) => mentions[m]!.map((w) => group[w]!)))]
      .filter((d) => d !== g)
      .sort((a, b) => groups[a]![0]! - groups[b]![0]!),
  );
  const groupParses = groups.map((members) => members.some((m) => spellsParse(spelled[m]!)));

  // Every group a group reaches, for what a unit's includes already bring.
  const reach = new Map<number, Set<number>>();
  const reached = (g: number): Set<number> => {
    let r = reach.get(g);
    if (r) return r;
    r = new Set([g]);
    reach.set(g, r);
    for (const d of deps[g]!) for (const x of reached(d)) r.add(x);
    return r;
  };

  const files = new Map<string, cpp.Decl[]>();
  const hasReaders = readers.decls.length > 0;
  if (hasReaders) {
    // The types it names declared, not included: a header of one may include this one.
    files.set(READER_DECLS, [
      { k: "pragmaOnce" },
      cpp.include(INDEX_HEADER),
      app(declared(identifiers(cpp.printDecls(readers.decls)))),
      cpp.namespace("lucent", readers.decls),
    ]);
    const used = groupsSpelled(identifiers(cpp.printDecls(readers.defs)));
    files.set(READER_DEFS, [
      { k: "pragmaOnce" },
      cpp.include(READER_DECLS),
      ...used.map((g) => cpp.include(headerOf(g))),
      cpp.namespace("lucent", readers.defs),
    ]);
  }
  groups.forEach((members, g) => {
    const of = (part: "defs" | "decls" | "inline") => members.flatMap((m) => items[m]![part]);
    files.set(headerOf(g), [
      { k: "pragmaOnce" },
      cpp.include(INDEX_HEADER),
      ...deps[g]!.map((d) => cpp.include(headerOf(d))),
      // Code that parses JSON sees the readers' specializations before it is instantiated.
      ...(hasReaders && groupParses[g] ? [cpp.include(READER_DECLS)] : []),
      app([
        ...members.map((m) => forward.get(items[m]!.name)!),
        ...of("defs"),
        ...of("decls"),
        ...of("inline"),
      ]),
    ]);
  });

  function groupsSpelled(names: ReadonlySet<string>): number[] {
    const gs = new Set<number>();
    for (const n of names) {
      const i = index.get(n);
      if (i !== undefined) gs.add(group[i]!);
    }
    return [...gs].sort((a, b) => groups[a]![0]! - groups[b]![0]!);
  }

  /** The groups the type headers among `decls`' includes reach. */
  const byHeader = new Map(groups.map((_, g) => [headerOf(g), g]));
  const includedGroups = (decls: readonly cpp.Decl[]): Set<number> => {
    const out = new Set<number>();
    for (const d of decls)
      if (d.k === "include") {
        const g = byHeader.get(d.path.replace(/^(\.\.\/)+/, ""));
        if (g !== undefined) for (const x of reached(g)) out.add(x);
      }
    return out;
  };

  return {
    files,
    includes(decls, already = [], prefix = "") {
      const names = spelledIn(decls);
      const have = includedGroups(already);
      const want = groupsSpelled(names);
      const types = want.filter((g) => !have.has(g)).map((g) => cpp.include(prefix + headerOf(g)));
      const parses =
        hasReaders &&
        (spellsParse(names) ||
          [...want, ...have].some((g) => [...reached(g)].some((x) => groupParses[x])));
      const readersIncluded = already.some(
        (d) => d.k === "include" && d.path.endsWith(READER_DEFS),
      );
      return {
        types,
        readers: parses && !readersIncluded ? [cpp.include(prefix + READER_DEFS)] : [],
      };
    },
    all(prefix = "") {
      return [
        ...groups.map((_, g) => cpp.include(prefix + headerOf(g))),
        ...(hasReaders ? [cpp.include(prefix + READER_DEFS)] : []),
      ];
    },
  };
}
