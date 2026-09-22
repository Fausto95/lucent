/** Pure semver helpers behind the lockstep release bump: plain data in, plain data out, no IO. */
export type Bump = "major" | "minor" | "patch";

type Parts = readonly [major: number, minor: number, patch: number];

const bumps: Record<Bump, (parts: Parts) => Parts> = {
  major: ([major]) => [major + 1, 0, 0],
  minor: ([major, minor]) => [major, minor + 1, 0],
  patch: ([major, minor, patch]) => [major, minor, patch + 1],
};

export const bumpKinds = Object.keys(bumps) as Bump[];

export function isBump(value: string | undefined): value is Bump {
  return value !== undefined && (bumpKinds as readonly string[]).includes(value);
}

const plainSemver = /^(\d+)\.(\d+)\.(\d+)$/;

function parse(version: string): Parts {
  const match = plainSemver.exec(version);
  if (!match) throw new Error(`Expected a plain x.y.z version, got "${version}"`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function bumpVersion(version: string, bump: Bump): string {
  return bumps[bump](parse(version)).join(".");
}

/** Rewrites the `"version": "<from>"` line literally so the rest of the file keeps its formatting. */
export function replaceVersion(text: string, from: string, to: string): string {
  const line = `"version": "${from}"`;
  if (!text.includes(line)) throw new Error(`No ${line} line found`);
  return text.replace(line, `"version": "${to}"`);
}
