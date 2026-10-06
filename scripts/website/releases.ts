/**
 * The Releases section's data: the package's changelog, read from
 * packages/lucent/CHANGELOG.md (written by changesets), and the known
 * limitations of ROADMAP.md that users meet.
 */

export interface Release {
  version: string;
  /** "Minor Changes", "Patch Changes": as changesets heads them. */
  changes: { kind: string; entries: string[] }[];
}

/** A changesets entry's credit: the pull request, the commit, the author. */
const CREDIT =
  /^\[(#\d+)\]\(([^)]+)\)\s+\[`[0-9a-f]+`\]\([^)]+\)\s+Thanks \[@[^\]]+\]\([^)]+\)!\s+-\s+/;

/** Markdown list items, each joined onto one line. */
function items(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (line.startsWith("- ")) out.push(line.slice(2).trim());
    else if (line.trim() && out.length) out[out.length - 1] += ` ${line.trim()}`;
  }
  return out;
}

/** Each release of a changesets CHANGELOG.md, newest first; an entry ends with its pull request. */
export function parseChangelog(text: string): Release[] {
  const releases: Release[] = [];
  let lines: string[] = [];
  const flush = () => {
    const change = releases.at(-1)?.changes.at(-1);
    if (change)
      change.entries.push(
        ...items(lines).map((entry) => {
          const credit = CREDIT.exec(entry);
          return credit ? `${entry.slice(credit[0].length)} ([${credit[1]}](${credit[2]}))` : entry;
        }),
      );
    lines = [];
  };
  for (const line of text.split("\n")) {
    const version = /^## (\S+)/.exec(line);
    const kind = /^### (.+)/.exec(line);
    if (version || kind) flush();
    if (version) releases.push({ version: version[1]!, changes: [] });
    else if (kind) releases.at(-1)?.changes.push({ kind: kind[1]!, entries: [] });
    else lines.push(line);
  }
  flush();
  return releases;
}

/** The limitation groups users meet; the rest of the section is the maintainer's. */
const USER_FACING = ["Views", "Language, runtime and bindings"];

/**
 * ROADMAP.md's known limitations users meet, by group. Links to a task's
 * anchor point at ROADMAP.md on GitHub, where the task is.
 */
export function knownLimitations(roadmap: string): { title: string; items: string[] }[] {
  const section = /^## Known limitations and deferred checks\n([\s\S]*?)(?=^## )/m.exec(roadmap);
  if (!section) throw new Error('ROADMAP.md has no "## Known limitations and deferred checks"');
  const groups = section[1]!.split(/^### /m).slice(1);
  return USER_FACING.map((title) => {
    const group = groups.find((g) => g.startsWith(`${title}\n`));
    if (!group) throw new Error(`ROADMAP.md's known limitations have no "### ${title}"`);
    return {
      title,
      items: items(group.split("\n").slice(1)).map((item) =>
        item.replace(
          /\]\(#([\w-]+)\)/g,
          "](https://github.com/Fausto95/lucent/blob/main/ROADMAP.md#$1)",
        ),
      ),
    };
  });
}
