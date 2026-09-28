import { describe, expect, it } from "vite-plus/test";
import { graphSymbol, jarArtifact, jvmSymbol } from "../src/provenance.ts";

describe("artifact identities", () => {
  it("names an Android SDK platform's jar by its API level, and targets that level", () => {
    expect(jarArtifact("/opt/android-sdk/platforms/android-35/android.jar")).toEqual({
      artifact: "android-sdk:35",
      kind: "sdk",
      target: "android-35",
    });
  });

  it("names a Gradle dependency by its Maven coordinates", () => {
    const cache = "/home/me/.gradle/caches/modules-2/files-2.1";

    expect(jarArtifact(`${cache}/dev.orbit/tracking/1.0.0/5f2a/tracking-1.0.0.aar`)).toEqual({
      artifact: "maven:dev.orbit:tracking:1.0.0",
      kind: "aar",
    });
    expect(jarArtifact(`${cache}/com.example/util/2.1/9c0d/util-2.1.jar`)).toEqual({
      artifact: "maven:com.example:util:2.1",
      kind: "jar",
    });
  });

  it("names other archives by their file name, never their directory", () => {
    expect(jarArtifact("/Users/me/work/libs/widgets.aar")).toEqual({
      artifact: "aar:widgets.aar",
      kind: "aar",
    });
    expect(jarArtifact("/tmp/x/fixture.jar")).toEqual({ artifact: "jar:fixture.jar", kind: "jar" });
  });
});

describe("symbols", () => {
  it("prefixes a USR with its language, and a JVM name with jvm:", () => {
    expect(graphSymbol("s:6Shapes5PointV")).toBe("swift:s:6Shapes5PointV");
    expect(graphSymbol("c:objc(cs)UIDevice(py)batteryLevel")).toBe(
      "objc:c:objc(cs)UIDevice(py)batteryLevel",
    );
    expect(graphSymbol("c:@F@SecItemAdd")).toBe("c:c:@F@SecItemAdd");
    expect(jvmSymbol("android/os/Build$VERSION", "SDK_INT:I")).toBe(
      "jvm:android/os/Build$VERSION#SDK_INT:I",
    );
  });

  it("gives a member synthesized on a conforming type the extension's own symbol", () => {
    expect(
      graphSymbol("s:9CryptoKit12HashFunctionPAAE4hashFZ::SYNTHESIZED::s:9CryptoKit6SHA256V"),
    ).toBe("swift:s:9CryptoKit12HashFunctionPAAE4hashFZ");
  });
});
