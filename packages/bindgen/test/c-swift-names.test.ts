/**
 * The Swift names C functions are imported under (TA33): from a module's
 * API notes and its headers' swift_name attributes, which say which Swift
 * member a function is and where its `self` goes.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { cSwiftNames, swiftMemberOf } from "../src/c-swift-names.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "fixtures/c-swift-names");

describe("C functions' Swift names", () => {
  it("reads them from API notes and from swift_name attributes in headers", () => {
    expect(Object.fromEntries(cSwiftNames([dir]))).toEqual({
      DLDialGetLevel: "getter:DLDial.level(self:)",
      DLDialSetLevel: "setter:DLDial.level(self:newValue:)",
      DLDialCreateCopyTurned: "DLDial.turned(by:self:)",
      DLDialGetSpeed: "getter:DLDial.speed(self:)",
      DLDialCreate: "DLDial.init(level:)",
    });
  });

  it("says which member a name is, and where `self` goes among the C arguments", () => {
    expect(swiftMemberOf("getter:DLDial.level(self:)")).toEqual({
      kind: "getter",
      type: "DLDial",
      name: "level",
      self: 0,
    });
    expect(swiftMemberOf("DLDial.turned(by:self:)")).toEqual({
      kind: "method",
      type: "DLDial",
      name: "turned",
      self: 1,
    });
    expect(swiftMemberOf("DLDial.init(level:)")).toEqual({
      kind: "init",
      type: "DLDial",
      name: "init",
    });
  });
});
