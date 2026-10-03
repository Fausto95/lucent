/**
 * SDK modules' declarations, kept on disk with the SDK cache: writing
 * UIKit's or Foundation's takes a second, and every process (each build,
 * check or editor) would write them again. A module's declarations depend
 * on the code that writes them and on the SDKs and artifacts in use (they
 * read other modules' types), so both key them.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cacheRoot, sourcesHash } from "@lucent-lang/bindgen";

declare const __LUCENT_DECLARATIONS__: string | undefined;

/** The source directories of the code that writes SDK declarations, under `packages`. */
const WRITERS = ["compiler/src/sdk", "bindgen/src", "codegen/src", "codegen/src/ts"];

/** A hash of the code that writes SDK declarations, in the packages under `packages`. */
export function declarationsSourcesHash(packages: string): string {
  return crypto
    .createHash("sha256")
    .update(WRITERS.map((d) => sourcesHash(path.join(packages, d))).join("\n"))
    .digest("hex")
    .slice(0, 8);
}

let version: string | undefined;

/** Which code writes the declarations: the bundle's, else the sources'. */
function declarationsVersion(): string {
  if (version) return version;
  if (typeof __LUCENT_DECLARATIONS__ === "string") return (version = __LUCENT_DECLARATIONS__);

  return (version = declarationsSourcesHash(path.resolve(import.meta.dirname, "../../..")));
}

/**
 * The declarations `key` names (a kind, a platform and a module) for the
 * SDKs `identity` names: read from the cache, else made by `make` and
 * written there, whole or not at all.
 */
export function cachedDeclarations(
  cacheDir: string | undefined,
  identity: string,
  key: string[],
  make: () => string,
): string {
  const name = crypto
    .createHash("sha256")
    .update([declarationsVersion(), identity, ...key].join("\n"))
    .digest("hex")
    .slice(0, 24);
  const file = path.join(cacheRoot(cacheDir), "declarations", `${name}.d.ts`);

  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    // Not written yet.
  }

  const text = make();
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);

  return text;
}
