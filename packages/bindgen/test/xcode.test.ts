/**
 * What an app's Xcode project says Lucent binds against (TA32): the iOS
 * version its app target is deployed to, and the Swift packages the
 * project references (LucentNative links their products), at the
 * versions Package.resolved pins.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { xcodeApp } from "../src/xcode.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const ios = path.join(here, "fixtures/xcode/ios");

describe("an app's Xcode project", () => {
  it("deploys to its app target's iOS version, not its test target's or the project's", () => {
    expect(xcodeApp(ios)?.deploymentTarget).toBe("16.4");
  });

  it("references Swift packages at the versions Package.resolved pins, its dependencies' aside", () => {
    expect(xcodeApp(ios)?.packages).toEqual([
      {
        identity: "gauges",
        location: "https://github.com/acme/Gauges",
        version: "1.2.0",
        revision: "0123456789abcdef0123456789abcdef01234567",
      },
    ]);
    expect(xcodeApp(ios)?.resolved).toBe(
      path.join(ios, "App.xcworkspace/xcshareddata/swiftpm/Package.resolved"),
    );
  });

  it("is none without a project, and references nothing an unresolved project names", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-xcode-"));
    expect(xcodeApp(empty)).toBeUndefined();

    fs.cpSync(path.join(ios, "App.xcodeproj"), path.join(empty, "App.xcodeproj"), {
      recursive: true,
    });
    expect(xcodeApp(empty)).toEqual({
      project: path.join(empty, "App.xcodeproj"),
      deploymentTarget: "16.4",
      packages: [],
    });
  });

  it("references local Swift packages by their directory, which Package.resolved does not pin", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-xcode-"));
    fs.cpSync(ios, path.join(dir, "ios"), { recursive: true });
    const project = path.join(dir, "ios/App.xcodeproj/project.pbxproj");
    fs.writeFileSync(
      project,
      fs
        .readFileSync(project, "utf8")
        .replace(
          "packageReferences = (",
          'packageReferences = (\n\t\t\t\t9A1B2C3D4E5F60718293A4B6 /* XCLocalSwiftPackageReference "../Packages/Dials" */,',
        )
        .replace(
          "/* End XCRemoteSwiftPackageReference section */",
          `/* End XCRemoteSwiftPackageReference section */

/* Begin XCLocalSwiftPackageReference section */
\t\t9A1B2C3D4E5F60718293A4B6 /* XCLocalSwiftPackageReference "../Packages/Dials" */ = {
\t\t\tisa = XCLocalSwiftPackageReference;
\t\t\trelativePath = ../Packages/Dials;
\t\t};
/* End XCLocalSwiftPackageReference section */`,
        ),
    );
    fs.mkdirSync(path.join(dir, "Packages/Dials"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "Packages/Dials/Package.swift"),
      "// swift-tools-version:5.9\n",
    );

    expect(xcodeApp(path.join(dir, "ios"))?.localPackages).toEqual([
      { identity: "dials", path: path.join(dir, "Packages/Dials") },
    ]);
    // A local package Package.resolved also pins (another package's dependency) stays local.
    expect(xcodeApp(path.join(dir, "ios"))?.packages.map((p) => p.identity)).toEqual(["gauges"]);
  });
});
