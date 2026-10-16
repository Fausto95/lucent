/**
 * The headers of the libraries a native extension links (decision 0131):
 * prefab modules' include directories from the AARs the Android classpath
 * resolved, and vendored frameworks' headers, which the extension's header
 * is read with; and a build that reads an extension's header against a
 * prefab module, linking the package its AAR names.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { bindExtensions, type LucentPackage, resolveNative } from "@lucent-lang/compiler";
import { libraryHeaders } from "../src/cli/library-headers.ts";
import { runLucent } from "./run-to-exit.ts";

const zip = spawnSync("zip", ["-v"]).status === 0;
const clang = spawnSync(process.env.LUCENT_CLANG ?? "clang", ["--version"]).status === 0;

const write = (root: string, files: Record<string, string>) => {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
};

/**
 * An AAR with a prefab package `name` of one module, `mmkv`, whose header
 * declares `mmkv_count`, where Gradle's cache keeps com.tencent:mmkv.
 */
function aar(cache: string, name = "mmkv"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-aar-"));
  write(dir, {
    "prefab/prefab.json": JSON.stringify({ name, schema_version: 2, dependencies: [] }),
    "prefab/modules/mmkv/module.json": "{}",
    "prefab/modules/mmkv/include/MMKV/MMKV.h": "#pragma once\nint mmkv_count(void);\n",
    "classes.jar": "",
  });
  const file = path.join(cache, "files-2.1/com.tencent/mmkv/1.3.14/abc123/mmkv-1.3.14.aar");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const r = spawnSync("zip", ["-qr", file, "."], { cwd: dir });
  if (r.status !== 0) throw new Error(String(r.stderr));
  return file;
}

/** A package wrapping the prefab library: an extension whose header includes its header. */
const KV_FILES: Record<string, string> = {
  "package.json": JSON.stringify({
    name: "lucent-kv",
    version: "1.0.0",
    lucent: { sources: "src" },
  }),
  "lucent.json": JSON.stringify({
    ios: { nativeSources: ["native"] },
    android: {
      nativeSources: ["native"],
      dependencies: { "com.tencent:mmkv": "1.3.14" },
      prefab: { "com.tencent:mmkv": ["mmkv"] },
    },
    extensions: { kv: { header: "native/kv.h" } },
  }),
  "native/kv.h":
    '#include <MMKV/MMKV.h>\n#ifdef __cplusplus\nextern "C" {\n#endif\nint kv_count(void);\n#ifdef __cplusplus\n}\n#endif\n',
  "native/kv.cpp": '#include "kv.h"\nint kv_count(void) { return mmkv_count(); }\n',
  "src/kv.lucent.ts":
    'import { kv_count } from "lucent:ext/kv";\nexport function count(): number {\n  return kv_count();\n}\n',
};

function kvPackage(): LucentPackage {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-kv-"));
  write(dir, KV_FILES);
  return { name: "lucent-kv", version: "1.0.0", dir, sources: path.join(dir, "src") };
}

describe.skipIf(!zip)("a prefab module's headers", () => {
  it("come from the AAR the classpath resolved, extracted once, with its package's name", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-app-"));
    const classpath = path.join(root, ".lucent/android-classpath.json");
    write(root, {
      ".lucent/android-classpath.json": JSON.stringify({
        aars: [aar(root, "mmkv-core")],
        jars: [],
      }),
    });
    const native = resolveNative([kvPackage()]);

    const h = libraryHeaders(root, native, classpath);
    expect(h.prefabPending).toBe(false);
    expect(h.prefabNames).toEqual(new Map([["com.tencent:mmkv", "mmkv-core"]]));
    expect(h.includePaths).toHaveLength(1);
    expect(fs.readFileSync(path.join(h.includePaths[0]!, "MMKV/MMKV.h"), "utf8")).toContain(
      "mmkv_count",
    );
    // Again: the same directory, not extracted anew.
    expect(libraryHeaders(root, native, classpath).includePaths).toEqual(h.includePaths);
  });

  it("wait for a classpath, and fail for an AAR or a module it lacks, naming the field", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-app-"));
    const native = resolveNative([kvPackage()]);
    expect(libraryHeaders(root, native, undefined).prefabPending).toBe(true);

    const classpath = path.join(root, "classpath.json");
    write(root, { "classpath.json": JSON.stringify({ aars: [], jars: [] }) });
    expect(() => libraryHeaders(root, native, classpath)).toThrow(
      "lucent-kv/lucent.json: android.prefab.com.tencent:mmkv: the app's Android classpath has no AAR of com.tencent:mmkv; build again once Gradle resolves it",
    );

    const missing = resolveNative([
      (() => {
        const p = kvPackage();
        const json = JSON.parse(fs.readFileSync(path.join(p.dir, "lucent.json"), "utf8"));
        json.android.prefab["com.tencent:mmkv"] = ["mmkv", "crypt"];
        fs.writeFileSync(path.join(p.dir, "lucent.json"), JSON.stringify(json));
        return p;
      })(),
    ]);
    write(root, { "classpath.json": JSON.stringify({ aars: [aar(root)], jars: [] }) });
    expect(() => libraryHeaders(root, missing, classpath)).toThrow(
      "lucent-kv/lucent.json: android.prefab.com.tencent:mmkv: mmkv-1.3.14.aar has no prefab module crypt",
    );
  });

  it.skipIf(!clang)("let an extension's header include them", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-app-"));
    const classpath = path.join(root, "classpath.json");
    write(root, { "classpath.json": JSON.stringify({ aars: [aar(root)], jars: [] }) });
    const native = resolveNative([kvPackage()]);
    const h = libraryHeaders(root, native, classpath);

    const [ext] = bindExtensions(
      native.extensions.map((e) => ({
        ...e,
        includePaths: [...e.includePaths, ...h.includePaths],
      })),
    );
    expect(ext!.functions.map((f) => f.name)).toEqual(["kv_count"]);
  });
});

describe.skipIf(!clang)("a vendored framework's headers", () => {
  it("are on the extension's framework search path", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-kit-"));
    write(dir, {
      "package.json": JSON.stringify({ name: "lucent-kit", version: "1.0.0" }),
      "lucent.json": JSON.stringify({
        ios: { nativeSources: ["native"], vendoredFrameworks: ["vendor/Kit.framework"] },
        android: { nativeSources: ["native"] },
        extensions: { kit: { header: "native/kit.h" } },
      }),
      "vendor/Kit.framework/Headers/Kit.h": "#pragma once\nint kit_version(void);\n",
      "vendor/Kit.framework/Kit": "",
      "native/kit.h":
        '#include <Kit/Kit.h>\n#ifdef __cplusplus\nextern "C" {\n#endif\nint kit_major(void);\n#ifdef __cplusplus\n}\n#endif\n',
    });
    const native = resolveNative([{ name: "lucent-kit", version: "1.0.0", dir, sources: dir }]);
    const h = libraryHeaders(
      fs.mkdtempSync(path.join(os.tmpdir(), "lucent-app-")),
      native,
      undefined,
    );
    expect(h.frameworkPaths).toEqual([path.join(dir, "vendor")]);

    const [ext] = bindExtensions(
      native.extensions.map((e) => ({ ...e, frameworkPaths: h.frameworkPaths })),
    );
    expect(ext!.functions.map((f) => f.name)).toEqual(["kit_major"]);
  });
});

describe.skipIf(!zip || !clang)("building an app whose extension includes a prefab module", () => {
  it("reads the header against the AAR's headers, and links the package the AAR names", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-prefab-app-"));
    write(root, {
      "package.json": JSON.stringify({ name: "app", dependencies: { "lucent-kv": "1.0.0" } }),
      "src/use.lucent.ts":
        'import { count } from "lucent-kv/src/kv.lucent";\nexport function total(): number {\n  return count();\n}\n',
      ...Object.fromEntries(
        Object.entries(KV_FILES).map(([rel, text]) => [`node_modules/lucent-kv/${rel}`, text]),
      ),
    });
    write(root, {
      ".lucent/android-classpath.json": JSON.stringify({
        aars: [aar(root, "mmkv-core")],
        jars: [],
      }),
    });

    const r = runLucent(["build", "--platforms", "host", "--root", root], {
      env: { ...process.env, NO_COLOR: "1" },
    });
    expect(r.stdout + r.stderr).not.toMatch(/error|✗/i);
    expect(r.status).toBe(0);

    const cmake = fs.readFileSync(path.join(root, ".lucent/native/android/packages.cmake"), "utf8");
    expect(cmake).toContain("find_package(mmkv-core REQUIRED CONFIG) # com.tencent:mmkv");
    expect(cmake).toContain("target_link_libraries(lucentnative mmkv-core::mmkv)");
  });
});
