import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { kotlin as kt } from "../src/index.ts";

const { name, call, member, printExpr, printType } = kt;

const kotlinc = spawnSync("kotlinc", ["-version"], { encoding: "utf8" }).status === 0;

describe("Kotlin types", () => {
  it("print nullable, generic, function and suspend function types", () => {
    expect(printType(kt.type("String"))).toBe("String");
    expect(printType(kt.nullable(kt.type("String")))).toBe("String?");
    expect(printType(kt.type("List", kt.nullable(kt.type("Int"))))).toBe("List<Int?>");
    expect(printType(kt.fn([kt.type("Int")], kt.type("Unit")))).toBe("(Int) -> Unit");
    expect(printType(kt.fn([], kt.type("String"), { suspend: true }))).toBe("suspend () -> String");

    // A nullable function type needs parentheses.
    expect(printType(kt.nullable(kt.fn([], kt.type("Unit"))))).toBe("(() -> Unit)?");
    expect(printType(kt.star)).toBe("*");
  });
});

describe("Kotlin expressions", () => {
  it("escape identifiers that are keywords and strings with templates", () => {
    expect(printExpr(name("in"))).toBe("`in`");
    expect(printExpr(member(name("x"), "object"))).toBe("x.`object`");
    expect(printExpr(name("value"))).toBe("value");

    expect(printExpr(kt.str('a "quoted" $price\\n'))).toBe('"a \\"quoted\\" \\$price\\\\n"');
    expect(printExpr(kt.str("line\nbreak\ttab"))).toBe('"line\\nbreak\\ttab"');
  });

  it("print calls with named arguments, trailing lambdas, safe calls and elvis", () => {
    const x = name("x");

    expect(
      printExpr(
        call(member(x, "search"), [
          { value: name("prefix") },
          { name: "limit", value: kt.num(20) },
        ]),
      ),
    ).toBe("x.search(prefix, limit = 20)");
    expect(printExpr(call(name("launch"), [], kt.lambda([], [kt.exprStmt(name("work"))])))).toBe(
      "launch { work }",
    );
    expect(printExpr(kt.elvis(kt.safeMember(x, "title"), kt.str("")))).toBe('x?.title ?: ""');
    expect(printExpr(kt.notNull(member(x, "value")))).toBe("x.value!!");
  });

  it("add the parentheses precedence needs", () => {
    const a = name("a");
    const b = name("b");

    // `as` binds tighter than elvis, looser than a member access.
    expect(printExpr(member(kt.cast(a, kt.type("String")), "length"))).toBe("(a as String).length");
    expect(printExpr(kt.elvis(kt.cast(a, kt.type("String"), true), b))).toBe("a as? String ?: b");

    // Elvis is right-associative; && binds tighter than ||.
    expect(printExpr(kt.binary(kt.binary(a, "||", b), "&&", a))).toBe("(a || b) && a");
    expect(printExpr(kt.binary(a, "==", kt.nullLit))).toBe("a == null");
    expect(printExpr(kt.not(kt.binary(a, "==", b)))).toBe("!(a == b)");
  });

  it("print lambdas with parameters and anonymous objects", () => {
    expect(
      printExpr(
        kt.lambda(["value"], [kt.exprStmt(call(name("done"), [{ value: name("value") }]))]),
      ),
    ).toBe("{ value -> done(value) }");

    const listener = kt.objectExpr(
      [kt.type("Runnable")],
      [
        {
          k: "fun",
          modifiers: ["override"],
          name: "run",
          params: [],
          body: [kt.exprStmt(call(name("tick"), []))],
        },
      ],
    );
    expect(printExpr(listener)).toBe(
      "object : Runnable {\n  override fun run() {\n    tick()\n  }\n}",
    );
  });

  it("refuses what it cannot print instead of writing raw text", () => {
    expect(() => printExpr({ k: "raw", text: "whatever" } as never)).toThrow(
      /unsupported Kotlin expression/,
    );
    expect(() => printExpr(name("not an identifier"))).toThrow(/not a Kotlin identifier/);
  });
});

describe("Kotlin statements and declarations", () => {
  it("print try/catch/finally, when, throw and locals", () => {
    const unit = kt.printUnit({
      packageName: "dev.lucent.generated",
      decls: [
        {
          k: "fun",
          modifiers: [],
          name: "classify",
          params: [kt.param("n", kt.type("Int"))],
          ret: kt.type("String"),
          body: [
            kt.val("half", kt.binary(name("n"), "/", kt.num(2))),
            {
              k: "try",
              body: [
                {
                  k: "when",
                  subject: name("half"),
                  branches: [
                    { conditions: [kt.num(0)], body: [kt.ret(kt.str("zero"))] },
                    {
                      conditions: [],
                      body: [
                        kt.throwStmt(
                          call(name("IllegalStateException"), [{ value: kt.str("big") }]),
                        ),
                      ],
                    },
                  ],
                },
              ],
              catches: [
                {
                  name: "e",
                  type: kt.type("IllegalStateException"),
                  body: [kt.ret(kt.str("caught"))],
                },
              ],
              finally: [kt.exprStmt(call(name("println"), [{ value: kt.str("done") }]))],
            },
          ],
        },
      ],
    });

    expect(unit).toBe(`package dev.lucent.generated

fun classify(n: Int): String {
  val half = n / 2
  try {
    when (half) {
      0 -> {
        return "zero"
      }
      else -> {
        throw IllegalStateException("big")
      }
    }
  } catch (e: IllegalStateException) {
    return "caught"
  } finally {
    println("done")
  }
}
`);
  });

  it("print file annotations, imports, objects and annotated, external and suspend functions", () => {
    const unit = kt.printUnit({
      banner: "Generated by Lucent. Do not edit.",
      fileAnnotations: ['JvmName("LucentShims")'],
      packageName: "dev.lucent.generated",
      imports: ["kotlin.coroutines.Continuation", "kotlin.coroutines.startCoroutine"],
      decls: [
        {
          k: "object",
          name: "Shims",
          members: [
            {
              k: "fun",
              annotations: ["JvmStatic"],
              modifiers: ["external"],
              name: "complete",
              params: [
                kt.param("operation", kt.type("Long")),
                kt.param("value", kt.nullable(kt.type("Any"))),
              ],
            },
            {
              k: "fun",
              modifiers: ["suspend", "private"],
              name: "fetch",
              typeParams: ["T"],
              params: [kt.param("value", kt.type("T"))],
              ret: kt.type("T"),
              body: [kt.ret(name("value"))],
            },
          ],
        },
      ],
    });

    expect(unit).toBe(`// Generated by Lucent. Do not edit.
@file:JvmName("LucentShims")

package dev.lucent.generated

import kotlin.coroutines.Continuation
import kotlin.coroutines.startCoroutine

object Shims {
  @JvmStatic
  external fun complete(operation: Long, value: Any?)

  private suspend fun <T> fetch(value: T): T {
    return value
  }
}
`);
  });

  it("print type parameters' bounds: one inline, several in a where clause", () => {
    const comparable = kt.type("kotlin.Comparable", kt.type("T"));
    const fun = (bounds: Record<string, kt.Type[]>): kt.Fun => ({
      k: "fun",
      modifiers: [],
      typeParams: ["T", "R"],
      bounds,
      name: "best",
      params: [kt.param("items", kt.type("kotlin.collections.List", kt.type("T")))],
      ret: kt.type("R"),
    });
    const printed = (f: kt.Fun) =>
      kt.printUnit({ packageName: "p", imports: [], decls: [{ k: "object", name: "O", members: [f] }] });

    expect(printed(fun({ T: [comparable] }))).toContain(
      "  fun <T : kotlin.Comparable<T>, R> best(items: kotlin.collections.List<T>): R\n",
    );
    expect(printed(fun({ T: [comparable, kt.type("kotlin.CharSequence")] }))).toContain(
      "  fun <T, R> best(items: kotlin.collections.List<T>): R where T : kotlin.Comparable<T>, T : kotlin.CharSequence\n",
    );
  });

  it("print data classes with default values", () => {
    expect(
      kt.printUnit({
        packageName: "dev.lucent.compose",
        decls: [
          {
            k: "class",
            modifiers: ["data"],
            name: "Stats",
            params: [
              { property: "val", ...kt.param("label", kt.type("String"), kt.str("")) },
              { property: "val", ...kt.param("done", kt.type("Double"), kt.num("0.0")) },
            ],
            members: [],
          },
        ],
      }),
    ).toContain('data class Stats(val label: String = "", val done: Double = 0.0)');
  });

  it("prints the same text for the same tree", () => {
    const tree: kt.Unit = {
      packageName: "p",
      decls: [{ k: "fun", modifiers: [], name: "f", params: [], body: [] }],
    };

    expect(kt.printUnit(tree)).toBe(kt.printUnit(structuredClone(tree)));
  });
});

describe.skipIf(!kotlinc)("generated Kotlin compiles", () => {
  it("with warnings as errors: a shim calling a suspend function and reporting back", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-kotlin-"));
    const source = kt.printUnit({
      fileAnnotations: ['JvmName("LucentShims")'],
      packageName: "dev.lucent.generated",
      imports: [
        "kotlin.coroutines.Continuation",
        "kotlin.coroutines.EmptyCoroutineContext",
        "kotlin.coroutines.startCoroutine",
      ],
      decls: [
        {
          k: "fun",
          modifiers: ["suspend"],
          name: "search",
          params: [kt.param("prefix", kt.type("String")), kt.param("limit", kt.type("Int"))],
          ret: kt.type("List", kt.type("String")),
          body: [
            kt.ret(
              call(name("listOf"), [
                { value: kt.str("$prefix") },
                { value: call(member(name("limit"), "toString"), []) },
              ]),
            ),
          ],
        },
        {
          k: "fun",
          annotations: ['Suppress("unused")'],
          modifiers: [],
          name: "startSearch",
          params: [
            kt.param("prefix", kt.type("String")),
            kt.param(
              "done",
              kt.fn(
                [
                  kt.nullable(kt.type("List", kt.type("String"))),
                  kt.nullable(kt.type("Throwable")),
                ],
                kt.type("Unit"),
              ),
            ),
          ],
          body: [
            kt.val(
              "block",
              kt.lambda(
                [],
                [
                  kt.exprStmt(
                    call(name("search"), [
                      { value: name("prefix") },
                      { name: "limit", value: kt.num(20) },
                    ]),
                  ),
                ],
              ),
              kt.fn([], kt.type("List", kt.type("String")), { suspend: true }),
            ),
            kt.exprStmt(
              call(member(name("block"), "startCoroutine"), [
                {
                  value: kt.objectExpr(
                    [kt.type("Continuation", kt.type("List", kt.type("String")))],
                    [
                      {
                        k: "val",
                        modifiers: ["override"],
                        name: "context",
                        init: name("EmptyCoroutineContext"),
                      },
                      {
                        k: "fun",
                        modifiers: ["override"],
                        name: "resumeWith",
                        params: [
                          kt.param("result", kt.type("Result", kt.type("List", kt.type("String")))),
                        ],
                        body: [
                          kt.exprStmt(
                            call(name("done"), [
                              { value: call(member(name("result"), "getOrNull"), []) },
                              { value: call(member(name("result"), "exceptionOrNull"), []) },
                            ]),
                          ),
                        ],
                      },
                    ],
                  ),
                },
              ]),
            ),
          ],
        },
      ],
    });
    fs.writeFileSync(path.join(dir, "LucentShims.kt"), source);

    const r = spawnSync(
      "kotlinc",
      ["-Werror", "-d", path.join(dir, "out"), path.join(dir, "LucentShims.kt")],
      {
        encoding: "utf8",
      },
    );

    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  }, 180_000);
});
