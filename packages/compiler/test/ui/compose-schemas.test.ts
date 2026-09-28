import { describe, expect, it } from "vite-plus/test";
import { COMPOSE_BOM } from "../../src/native-build-files.ts";
import { composeModule, composeModuleNames, composeSchemas } from "../../src/ui/compose-schemas.ts";
import { bindCompose, comparableSchemas, composeArtifacts } from "./compose-artifacts.ts";

/*
 * The Compose bindings Lucent ships (lib/sdk/compose.schemas.json.gz): the
 * schemas of the Compose release the Android library builds with, which
 * scripts/compose-bindings.ts makes from its Kotlin metadata.
 */

const artifacts = composeArtifacts();

describe("Compose's bindings shipped with Lucent", () => {
  it("are those of the Compose release the Android library builds with", () => {
    expect(composeSchemas().bom).toBe(COMPOSE_BOM);
    expect(composeSchemas().libraries).toEqual(
      expect.arrayContaining([
        "maven:androidx.compose.runtime:runtime-android:1.10.5",
        "maven:androidx.compose.ui:ui-android:1.10.5",
        "maven:androidx.compose.foundation:foundation-layout-android:1.10.5",
        "maven:androidx.compose.animation:animation-core-android:1.10.5",
        // Bound too, and depended on when content uses it.
        "maven:androidx.compose.material3:material3-android:1.4.0",
      ]),
    );
  });

  it("declare Compose's packages as modules called from Kotlin source", () => {
    const layout = composeModule("androidx.compose.foundation.layout");

    expect(layout).toMatchObject({ platform: "android", form: "source" });
    expect(layout?.functions?.find((f) => f.name === "Column")).toMatchObject({
      kotlin: { composable: true, applier: "androidx.compose.ui.UiComposable" },
    });
    expect(composeModuleNames()).toEqual(
      expect.arrayContaining([
        "androidx.compose.runtime",
        "androidx.compose.ui",
        "androidx.compose.ui.graphics",
        "androidx.compose.ui.unit",
        "androidx.compose.foundation",
        "androidx.compose.animation",
      ]),
    );
    // Classes of the dependencies, declared for the API that names them, are not Compose's modules.
    expect(composeSchemas().modules.map((m) => m.module)).toContain("kotlinx.coroutines");
    expect(composeModule("kotlinx.coroutines")).toBeUndefined();
    // AndroidX's internal packages are left out.
    expect(composeModuleNames().filter((m) => /\.internal(\.|$)/.test(m))).toEqual([]);
  });

  it.skipIf("missing" in artifacts)(
    "are what scripts/compose-bindings.ts makes of the release's libraries",
    () => {
      if ("missing" in artifacts) return;

      expect(comparableSchemas(composeSchemas())).toEqual(
        comparableSchemas(bindCompose(artifacts)),
      );
    },
    120_000,
  );
});
