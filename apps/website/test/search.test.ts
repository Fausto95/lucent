import { describe, expect, it } from "vitest";
import { search } from "../src/docs/search.ts";

const entries = [
  { href: "/docs/guides/cancel-work/", page: "Cancel work", text: "Pass an AbortSignal from JavaScript. Your code stops where it checks." },
  { href: "/docs/reference/built-ins/", page: "Built-ins", text: "AbortController and AbortSignal: signal, abort, aborted, throwIfAborted." },
  { href: "/docs/thinking/threads/#when-you-need-main", page: "Which thread your code runs on", heading: "When you need main()", text: "UIKit compiles only inside main." },
  { href: "/docs/install/", page: "Install Lucent", text: "Add one dev dependency and run lucent init." },
];

describe("search", () => {
  it("finds nothing for an empty query", () => {
    expect(search(entries, "  ")).toEqual([]);
  });

  it("matches word prefixes, case-insensitively", () => {
    expect(search(entries, "abort").map((r) => r.href)).toEqual(["/docs/guides/cancel-work/", "/docs/reference/built-ins/"]);
  });

  it("needs every word of the query", () => {
    expect(search(entries, "abort javascript").map((r) => r.href)).toEqual(["/docs/guides/cancel-work/"]);
  });

  it("ranks a title or heading match above a match in the text", () => {
    expect(search(entries, "main").map((r) => r.href)[0]).toBe("/docs/thinking/threads/#when-you-need-main");
    expect(search(entries, "install lucent").map((r) => r.href)[0]).toBe("/docs/install/");
  });

  it("gives a snippet around the first match in the text", () => {
    const [first] = search(entries, "throwifaborted");
    expect(first?.snippet).toContain("throwIfAborted");
  });
});
