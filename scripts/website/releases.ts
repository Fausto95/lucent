/**
 * The Releases section's data: the package's changelog, read from
 * packages/lucent/CHANGELOG.md (written by changesets), and the known
 * limitations of docs/limitations.md that users meet.
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

/** The limitation groups users meet; the rest of the file is the maintainer's. */
const USER_FACING = ["Views", "Language, runtime and bindings"];

const BLOB = "https://github.com/Fausto95/lucent/blob/main";

/**
 * docs/limitations.md's groups users meet (its `## ` sections). Relative
 * links point at the repository on GitHub, where the tasks are: the page
 * is on the website.
 */
export function knownLimitations(limitations: string): { title: string; items: string[] }[] {
  const groups = limitations.split(/^## /m).slice(1);
  return USER_FACING.map((title) => {
    const group = groups.find((g) => g.startsWith(`${title}\n`));
    if (!group) throw new Error(`docs/limitations.md has no "## ${title}"`);
    return {
      title,
      items: items(group.split("\n").slice(1)).map((item) =>
        item
          .replace(/\]\(tasks\.md#([\w-]+)\)/g, `](${BLOB}/docs/tasks.md#$1)`)
          .replace(/\]\(\.\.\/ROADMAP\.md#([\w-]+)\)/g, `](${BLOB}/ROADMAP.md#$1)`),
      ),
    };
  });
}
