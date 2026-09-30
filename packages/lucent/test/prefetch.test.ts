import { describe, expect, it } from "vite-plus/test";
import { prefetchJobs } from "../src/cli/project.ts";

const imports = {
  ios: ["AVFoundation", "UIKit"],
  android: ["android.app", "android.os", "android.view", "android.widget"],
};

describe("the build's background prefetch", () => {
  it("extracts the modules of the platforms it builds, in at most the processes it may start", () => {
    // Round robin: the build extracts in order, and finds the first modules under way.
    expect(prefetchJobs(imports, ["android"], 3)).toEqual([
      ["--android", "android.app,android.widget"],
      ["--android", "android.os"],
      ["--android", "android.view"],
    ]);

    expect(prefetchJobs(imports, ["android"], 8)).toHaveLength(4);
  });

  it("gives a process each platform's share, and never an empty list, which means every module", () => {
    expect(prefetchJobs(imports, ["ios", "android"], 2)).toEqual([
      ["--ios", "AVFoundation", "--android", "android.app,android.view"],
      ["--ios", "UIKit", "--android", "android.os,android.widget"],
    ]);

    expect(
      prefetchJobs({ ios: ["UIKit"], android: ["android.os"] }, ["ios", "android"], 2),
    ).toEqual([
      ["--ios", "UIKit"],
      ["--android", "android.os"],
    ]);

    expect(prefetchJobs({ ios: [], android: [] }, ["ios", "android"], 4)).toEqual([]);
  });
});
