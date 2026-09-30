import { describe, expect, it } from "vite-plus/test";
import { parentRoute, parseRoute, routePath } from "./routes";

const catalog = { demos: ["crypto", "location"], lab: ["tests", "sdk", "bench", "compare"] };

describe("parseRoute", () => {
  it("opens a demo or a Lab screen from a deep link", () => {
    expect(parseRoute("lucentbare://examples/crypto", catalog)).toEqual({
      screen: "demo",
      id: "crypto",
    });

    expect(parseRoute("lucentexpo://lab/tests", catalog)).toEqual({ screen: "lab", id: "tests" });
  });

  it("opens a home section from a deep link", () => {
    expect(parseRoute("lucentbare://lab", catalog)).toEqual({ screen: "home", section: "lab" });

    expect(parseRoute("lucentbare://examples/", catalog)).toEqual({
      screen: "home",
      section: "examples",
    });

    expect(parseRoute("lucentbare://", catalog)).toEqual({ screen: "home", section: "examples" });
  });

  it("takes a path or a bare screen name, as a launch argument gives it", () => {
    expect(parseRoute("lab/bench", catalog)).toEqual({ screen: "lab", id: "bench" });

    expect(parseRoute("sdk", catalog)).toEqual({ screen: "lab", id: "sdk" });

    expect(parseRoute("location", catalog)).toEqual({ screen: "demo", id: "location" });
  });

  it("ignores case, surrounding space, a query and a fragment", () => {
    expect(parseRoute("  LucentBare://Lab/Compare?run=1#top ", catalog)).toEqual({
      screen: "lab",
      id: "compare",
    });
  });

  it("names nothing for unknown screens and foreign links", () => {
    expect(parseRoute("lucentbare://lab/crypto", catalog)).toBeNull();

    expect(parseRoute("lucentbare://settings", catalog)).toBeNull();

    expect(parseRoute("lucentbare://examples/crypto/extra", catalog)).toBeNull();

    expect(
      parseRoute(
        "exp+lucent-expo-example://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8081",
        catalog,
      ),
    ).toBeNull();
  });
});

describe("routePath", () => {
  it("is the path parseRoute reads back", () => {
    const routes = [
      { screen: "home", section: "lab" },
      { screen: "demo", id: "crypto" },
      { screen: "lab", id: "tests" },
    ] as const;

    for (const route of routes) {
      expect(parseRoute(routePath(route), catalog)).toEqual(route);
    }
  });
});

describe("parentRoute", () => {
  it("goes back to the home section a screen belongs to", () => {
    expect(parentRoute({ screen: "demo", id: "crypto" })).toEqual({
      screen: "home",
      section: "examples",
    });

    expect(parentRoute({ screen: "lab", id: "tests" })).toEqual({ screen: "home", section: "lab" });
  });

  it("has nowhere to go from home", () => {
    expect(parentRoute({ screen: "home", section: "lab" })).toBeNull();
  });
});
