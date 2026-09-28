/**
 * Whether two packages' requirements on one native dependency can both
 * hold. The platform's resolver picks the version; these only reject what
 * provably fails, so the error can name both packages.
 */

type Version = number[];

/** A range of versions; an absent bound is open. */
interface Range {
  lo?: { v: Version; inclusive: boolean };
  hi?: { v: Version; inclusive: boolean };
}

function compare(a: Version, b: Version): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }

  return 0;
}

/** `~> 1.2.3` allows up to 1.3; `~> 1.2` up to 2; `~> 1` up to 2. */
function pessimisticUpper(v: Version): Version {
  const head = v.length > 1 ? v.slice(0, -1) : [...v];
  head[head.length - 1]! += 1;

  return head;
}

/** CocoaPods' requirement operators, as ranges. */
const POD_OPERATORS: Record<string, (v: Version) => Range> = {
  "=": (v) => ({ lo: { v, inclusive: true }, hi: { v, inclusive: true } }),
  ">=": (v) => ({ lo: { v, inclusive: true } }),
  ">": (v) => ({ lo: { v, inclusive: false } }),
  "<=": (v) => ({ hi: { v, inclusive: true } }),
  "<": (v) => ({ hi: { v, inclusive: false } }),
  "~>": (v) => ({ lo: { v, inclusive: true }, hi: { v: pessimisticUpper(v), inclusive: false } }),
};

function intersect(a: Range, b: Range): Range {
  const pick = (x: Range["lo"], y: Range["lo"], sign: 1 | -1): Range["lo"] => {
    if (!x) return y;
    if (!y) return x;

    const d = compare(x.v, y.v) * sign;
    if (d !== 0) return d > 0 ? x : y;

    return { v: x.v, inclusive: x.inclusive && y.inclusive };
  };

  return { lo: pick(a.lo, b.lo, 1), hi: pick(a.hi, b.hi, -1) };
}

function isEmpty(r: Range): boolean {
  if (!r.lo || !r.hi) return false;

  const d = compare(r.lo.v, r.hi.v);

  return d > 0 || (d === 0 && !(r.lo.inclusive && r.hi.inclusive));
}

/** A pod requirement (`~> 1.0`, `>= 1.2, < 2`) as a range; undefined for syntax this does not model. */
function podRange(requirement: string): Range | undefined {
  let range: Range = {};

  for (const part of requirement.split(",")) {
    const m = /^\s*(~>|>=|<=|>|<|=)?\s*(\d+(?:\.\d+)*)\s*$/.exec(part);
    if (!m) return undefined;

    range = intersect(range, POD_OPERATORS[m[1] ?? "="]!(m[2]!.split(".").map(Number)));
  }

  return range;
}

/** Whether some version meets both pod requirements (unknown syntax: CocoaPods decides). */
export function podsCompatible(a: string, b: string): boolean {
  const ra = podRange(a);
  const rb = podRange(b);

  return !ra || !rb || !isEmpty(intersect(ra, rb));
}

/** Orders dotted versions numerically: `16` equals `16.0`, `15.10` follows `15.9`. */
export function compareVersions(a: string, b: string): number {
  return compare(a.split(".").map(Number), b.split(".").map(Number));
}

/** A strict Gradle version (`1.0!!`) excludes every other; plain versions are Gradle's to pick from. */
export const gradleCompatible = (a: string, b: string) => !a.endsWith("!!") && !b.endsWith("!!");
