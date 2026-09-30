/**
 * Files and directories Lucent packages list in their lucent.json (native
 * sources, resources, prebuilt frameworks and libraries): located in the
 * package that lists them, hashed by content, and copied into the native
 * package under `packages/<package>/`.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** A path a package lists, as the build resolved it. Portable: no machine path. */
export interface PackagePath {
  /** The package that lists it. */
  package: string;
  /** Relative to that package, with `/`. */
  path: string;
  /** Of every file under it: their paths and contents. */
  hash: string;
}

/** A listed path, and its files. */
export interface Located extends PackagePath {
  /** Each file: its path under the listed one (`""` for a listed file), and where it is. */
  files: { rel: string; abs: string }[];
}

/** What a listed path must be. */
export interface PathKind {
  directory?: boolean;
  /** The extensions its name may end with. */
  suffixes?: string[];
  /** For the error: `is not <describe>`. */
  describe: string;
}

export const DIRECTORY: PathKind = { directory: true, describe: "a directory" };

export const FILE_OR_DIRECTORY: PathKind = { describe: "a file or directory" };

const hash = (data: string | Buffer) =>
  crypto.createHash("sha256").update(data).digest("hex").slice(0, 16);

/** Files' content hashes, reused while their size and times say they did not change. */
export interface FileHashes {
  /** The hash of `file`'s content. */
  of(file: string): string;
  /** Keeps the hashes of the files asked about in this run, for the next. */
  save(): void;
  /** In this run: hashes reused, and files read and hashed. */
  stats(): { hits: number; hashed: number };
}

interface HashEntry {
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  ino: number;
  hash: string;
  /** When it was hashed. */
  at: number;
}

/**
 * Same-time writes can leave a file's times as they were: an entry is
 * trusted only for a file last changed this long before it was hashed.
 */
const RACY_MS = 1000;

/** File hashes kept in `store` (a JSON file) between runs; in memory only without one. */
export function fileHashes(store?: string): FileHashes {
  let known: Record<string, HashEntry> = {};

  if (store && fs.existsSync(store)) {
    try {
      known = JSON.parse(fs.readFileSync(store, "utf8")) as Record<string, HashEntry>;
    } catch {
      // Unreadable: every file is hashed again.
    }
  }

  const used: Record<string, HashEntry> = {};
  const stats = { hits: 0, hashed: 0 };

  return {
    of(file) {
      const st = fs.statSync(file);
      const entry = known[file];

      if (
        entry &&
        entry.size === st.size &&
        entry.mtimeMs === st.mtimeMs &&
        entry.ctimeMs === st.ctimeMs &&
        entry.ino === st.ino &&
        st.mtimeMs < entry.at - RACY_MS
      ) {
        stats.hits++;
        used[file] = entry;

        return entry.hash;
      }

      stats.hashed++;
      const at = Date.now();
      const h = hash(fs.readFileSync(file));
      used[file] = {
        size: st.size,
        mtimeMs: st.mtimeMs,
        ctimeMs: st.ctimeMs,
        ino: st.ino,
        hash: h,
        at,
      };

      return h;
    },

    save() {
      if (!store) return;

      fs.mkdirSync(path.dirname(store), { recursive: true });

      const tmp = `${store}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(used));
      fs.renameSync(tmp, store);
    },

    stats: () => ({ ...stats }),
  };
}

/** Files under `dir`, sorted, following links; hidden ones (`.DS_Store`, `.git`) stay behind. */
function walk(dir: string, prefix = ""): { rel: string; abs: string }[] {
  return fs
    .readdirSync(dir)
    .filter((name) => !name.startsWith("."))
    .sort()
    .flatMap((name) => {
      const abs = path.join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;

      return fs.statSync(abs).isDirectory() ? walk(abs, rel) : [{ rel, abs }];
    });
}

/**
 * `listed`, a path in package `pkg`'s lucent.json field `field`, located in
 * the package. Throws, naming the package, the field and the path, for one
 * outside the package, missing, or not of `kind`.
 */
export function locate(
  pkg: { name: string; dir: string },
  field: string,
  listed: string,
  kind: PathKind,
  hashes: FileHashes = fileHashes(),
): Located {
  const fail = (problem: string): never => {
    throw new Error(`${pkg.name}/lucent.json: ${field} ${JSON.stringify(listed)} ${problem}`);
  };

  const rel = path.posix.normalize(listed.replace(/\\/g, "/")).replace(/\/$/, "");

  if (path.isAbsolute(listed) || rel === "." || rel === ".." || rel.startsWith("../"))
    fail("is outside the package");

  const abs = path.join(pkg.dir, rel);

  if (!fs.existsSync(abs)) fail("does not exist");

  const directory = fs.statSync(abs).isDirectory();

  if (
    (kind.directory !== undefined && directory !== kind.directory) ||
    (kind.suffixes && !kind.suffixes.some((s) => rel.endsWith(s)))
  )
    fail(`is not ${kind.describe}`);

  const files = directory ? walk(abs) : [{ rel: "", abs }];
  const contents = files.map((f) => `${f.rel}\0${hashes.of(f.abs)}\n`).join("");

  return { package: pkg.name, path: rel, hash: hash(contents), files };
}

/** Where the native package has `p` (or its file `rel`), relative to the native package. */
export function inNativePackage(p: PackagePath, rel = ""): string {
  return ["packages", p.package, p.path, rel].filter(Boolean).join("/");
}

/**
 * Fails when two listed files land in the same place of the app, naming
 * both packages and their paths. `places` gives each place a listed path
 * puts files in, and the file (package-relative) it puts there.
 */
export function landsOnce(
  what: string,
  located: Located[],
  places: (l: Located) => [place: string, file: string][],
  hint = "",
): void {
  const taken = new Map<string, { package: string; file: string }>();

  for (const l of located)
    for (const [place, file] of places(l)) {
      const other = taken.get(place);

      if (other && (other.package !== l.package || other.file !== file))
        throw new Error(
          `${what} ${place}: ${other.package} has ${other.file}, ${l.package} has ${file}${hint}`,
        );

      taken.set(place, { package: l.package, file });
    }
}

/** Each file of `l` by its path under the listed one, and its package-relative path. */
export const eachFile = (l: Located, keep: (rel: string) => boolean = () => true) =>
  l.files
    .filter((f) => keep(f.rel))
    .map((f): [string, string] => [f.rel, f.rel ? `${l.path}/${f.rel}` : l.path]);
