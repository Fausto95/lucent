import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const loaderFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../js/index.js");

interface Identity {
  runtimeAbi: number;
  programs: Record<string, string>;
  apis: Record<string, Record<string, string>>;
}

interface Loader {
  loadModule(name: string, registry: () => unknown, expected?: Identity): Record<string, unknown>;
}

/** The loader as a new JavaScript runtime evaluates it: nothing checked yet. */
function freshLoader(): Loader {
  const module = { exports: {} as Loader };

  new Function("module", "exports", fs.readFileSync(loaderFile, "utf8"))(module, module.exports);

  return module.exports;
}

/** What `lucent build` wrote next to the proxies: the build this JavaScript was compiled with. */
const built: Identity = {
  runtimeAbi: 1,
  programs: { all: "program-1" },
  apis: { all: { a: "api-a1", b: "api-b1" } },
};

/** An app's native code, as the host installs it: the modules, and what they were built from. */
function installNative(
  identity?: Partial<{
    host: number;
    runtimeAbi: number;
    target: string;
    program: string;
    modules: Record<string, string>;
  }>,
) {
  const modules = { a: { one: () => 1 }, b: { two: () => 2 } };

  (globalThis as { __lucentModules?: unknown }).__lucentModules = {
    ...modules,
    ...(identity && {
      __lucentIdentity: {
        host: 1,
        runtimeAbi: 1,
        target: "all",
        program: "program-1",
        modules: { a: "api-a1", b: "api-b1" },
        ...identity,
      },
    }),
  };

  return modules;
}

const noRegistry = () => ({ get: () => undefined });

function failure(run: () => unknown): Error & { code?: string; action?: string } {
  try {
    run();
  } catch (e) {
    return e as Error;
  }

  throw new Error("expected a failure");
}

afterEach(() => {
  delete (globalThis as { __lucentModules?: unknown }).__lucentModules;
  vi.restoreAllMocks();
});

describe("the loader's check of the app's native code", () => {
  it("loads modules built with this JavaScript, and says nothing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const modules = installNative({});
    const loader = freshLoader();

    expect(loader.loadModule("a", noRegistry, built)).toBe(modules.a);
    expect(loader.loadModule("b", noRegistry, built)).toBe(modules.b);
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps a JavaScript-only update compatible: the same build identity", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const modules = installNative({});

    // The app's own JavaScript changed and reloaded; the proxies did not.
    for (let i = 0; i < 2; i++)
      expect(freshLoader().loadModule("a", noRegistry, { ...built })).toBe(modules.a);

    expect(warn).not.toHaveBeenCalled();
  });

  it("refuses an app built before its native code had an identity: rebuild it", () => {
    installNative();

    const e = failure(() => freshLoader().loadModule("a", noRegistry, built));

    expect(e.code).toBe("LUCENT_NATIVE_MISMATCH");
    expect(e.action).toBe("compile-native");
    expect(e.message).toMatch(/built before .*lucent build.*compile-native/s);
    expect(e.message).toMatch(/cannot replace native code/);
  });

  it("refuses new proxies over a stale binary whose module's API differs", () => {
    installNative({ program: "program-0", modules: { a: "api-a0", b: "api-b1" } });

    const loader = freshLoader();
    const e = failure(() => loader.loadModule("a", noRegistry, built));

    expect(e.action).toBe("compile-native");
    expect(e.message).toMatch(/module "a".*api-a0.*api-a1/s);
  });

  it("refuses a module the installed app does not have", () => {
    installNative({ modules: { b: "api-b1" } });

    const e = failure(() => freshLoader().loadModule("a", noRegistry, built));

    expect(e.action).toBe("compile-native");
    expect(e.message).toMatch(/module "a" is not in the app's native code/);
  });

  it("refuses native code for a target this JavaScript was not built for", () => {
    installNative({ target: "android" });

    const e = failure(() =>
      freshLoader().loadModule("a", noRegistry, {
        ...built,
        programs: { ios: "p" },
        apis: { ios: built.apis.all! },
      }),
    );

    expect(e.action).toBe("compile-native");
    expect(e.message).toMatch(/android/);
  });

  it("refuses a runtime of another ABI: an older one to rebuild, a newer one to reload", () => {
    installNative({ runtimeAbi: 0 });
    const older = failure(() => freshLoader().loadModule("a", noRegistry, built));

    installNative({ runtimeAbi: 2 });
    const newer = failure(() => freshLoader().loadModule("a", noRegistry, built));

    expect(older.action).toBe("compile-native");
    expect(older.message).toMatch(/runtime ABI 0.*needs 1/s);
    expect(newer.action).toBe("reload-js");
    expect(newer.message).toMatch(/runtime ABI 2.*needs 1/s);
  });

  it("warns once per host when only the implementation differs, and loads the module", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const modules = installNative({ program: "program-0" });
    const loader = freshLoader();

    expect(loader.loadModule("a", noRegistry, built)).toBe(modules.a);
    expect(loader.loadModule("b", noRegistry, built)).toBe(modules.b);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(
      /program-0.*program-1.*compile-native.*reload-js/s,
    );
  });

  it("checks again for a new host (a reload), and for a new build of this JavaScript", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    installNative({ program: "program-0" });
    const loader = freshLoader();

    loader.loadModule("a", noRegistry, built);
    installNative({ host: 2, program: "program-0" });
    loader.loadModule("a", noRegistry, built);

    expect(warn).toHaveBeenCalledTimes(2);

    // The app was rebuilt from the sources Metro serves: nothing more to say.
    installNative({ host: 3 });
    loader.loadModule("a", noRegistry, built);

    // Metro served a new build of this JavaScript to the same host.
    loader.loadModule("a", noRegistry, { ...built, programs: { all: "program-2" } });

    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("checks nothing for a proxy from before build identities", () => {
    const modules = installNative();

    expect(freshLoader().loadModule("a", noRegistry)).toBe(modules.a);
  });
});
