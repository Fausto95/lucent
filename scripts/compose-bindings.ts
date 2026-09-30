/**
 * Binds Compose's libraries (packages/compiler/lib/sdk/compose.schemas.json.gz)
 * from their Kotlin metadata, at the versions of the Compose BOM the
 * generated Android library builds with (COMPOSE_BOM), found in Gradle's
 * cache: an Android build of an app with Compose content downloads them.
 * Run it after changing the BOM or the Compose libraries, or bindgen's
 * rules for them; `--check` exits 1 when the shipped file differs.
 *
 *   node scripts/compose-bindings.ts [--check]
 */
import fs from "node:fs";
import zlib from "node:zlib";
import { sdkLibFile } from "../packages/compiler/src/lib-files.ts";
import {
  COMPOSE_SCHEMAS,
  type ComposeSchemaFile,
} from "../packages/compiler/src/ui/compose-schemas.ts";
import {
  bindCompose,
  comparableSchemas,
  composeArtifacts,
} from "../packages/compiler/test/ui/compose-artifacts.ts";

const artifacts = composeArtifacts();

if ("missing" in artifacts) {
  console.error(
    `Gradle's cache lacks ${artifacts.missing.join(", ")}: build an Android app with Compose content first`,
  );
  process.exit(1);
}

const bound = bindCompose(artifacts);
const file = sdkLibFile(COMPOSE_SCHEMAS);

if (process.argv.includes("--check")) {
  const shipped = JSON.parse(
    zlib.gunzipSync(fs.readFileSync(file)).toString("utf8"),
  ) as ComposeSchemaFile;
  const same =
    JSON.stringify(comparableSchemas(shipped)) === JSON.stringify(comparableSchemas(bound));

  console.log(
    same ? `${file} is up to date` : `${file} is stale: run node scripts/compose-bindings.ts`,
  );
  process.exit(same ? 0 : 1);
}

fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(bound), { level: 9 }));

const members = bound.modules.reduce(
  (n, m) =>
    n +
    (m.functions?.length ?? 0) +
    (m.constants?.length ?? 0) +
    m.types.reduce(
      (k, t) =>
        k + (t.kind === "class" ? (t.methods?.length ?? 0) + (t.properties?.length ?? 0) : 0),
      0,
    ),
  0,
);
console.log(
  `${file}: ${bound.modules.length} modules, ${members} members, ${fs.statSync(file).size} bytes`,
);
