import { expect, test } from "vite-plus/test";
import { fillNative } from "../src/template.ts";

test("substitutes placeholders", () => {
  expect(fillNative("package {{androidPackage}}\n", { androidPackage: "com.example" })).toBe("package com.example\n");
});

test("substitutes every occurrence", () => {
  expect(fillNative("{{name}} and {{name}}", { name: "x" })).toBe("x and x");
});

test("leaves native interpolation alone", () => {
  const cmake = 'add_library(${PACKAGE_NAME} SHARED)\nset(PACKAGE_NAME {{moduleName}})';
  expect(fillNative(cmake, { moduleName: "NitroLucent" })).toBe(
    'add_library(${PACKAGE_NAME} SHARED)\nset(PACKAGE_NAME NitroLucent)',
  );
});

test("rejects an unknown token rather than emitting a hole", () => {
  expect(() => fillNative("{{missing}}", {})).toThrow("Unknown native template token {{missing}}");
});

test("accepts a value that itself looks like a token", () => {
  expect(fillNative("{{a}}", { a: "{{b}}" })).toBe("{{b}}");
});
