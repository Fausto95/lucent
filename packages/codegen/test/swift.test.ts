import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { swift } from "../src/index.ts";

const { name, call, member, printExpr, printType } = swift;
const raw = swift.type("UnsafeMutableRawPointer");

describe("Swift types", () => {
  it("print optionals, arrays, dictionaries, generics and C function types", () => {
    expect(printType(swift.optional(raw))).toBe("UnsafeMutableRawPointer?");
    expect(printType(swift.array(swift.type("String")))).toBe("[String]");
    expect(printType(swift.dictionary(swift.type("String"), swift.type("Any")))).toBe(
      "[String: Any]",
    );
    expect(printType(swift.type("LucentBox", swift.type("Point")))).toBe("LucentBox<Point>");
    expect(
      printType(swift.cFunction([swift.optional(raw), swift.optional(raw)], swift.type("Void"))),
    ).toBe("@convention(c) (UnsafeMutableRawPointer?, UnsafeMutableRawPointer?) -> Void");
    // An optional function type needs parentheses.
    expect(printType(swift.optional(swift.cFunction([], swift.type("Void"))))).toBe(
      "(@convention(c) () -> Void)?",
    );
  });

  it("print block function types, which Objective-C blocks are in Swift", () => {
    expect(printType(swift.blockFunction([swift.type("Double")], swift.type("String")))).toBe(
      "@convention(block) (Double) -> String",
    );
  });

  it("print Swift function types, parenthesized where optional", () => {
    const fn = swift.fn([swift.type("Double"), swift.type("String")], swift.type("Void"));

    expect(printType(fn)).toBe("(Double, String) -> Void");
    expect(printType(swift.optional(fn))).toBe("((Double, String) -> Void)?");
  });
});

describe("Swift expressions", () => {
  it("print labeled calls, members, casts, try and await", () => {
    const p = name("p");
    expect(printExpr(call(member(p, "distance"), [{ label: "to", value: name("a0") }]))).toBe(
      "p.distance(to: a0)",
    );
    expect(printExpr(call(name("Point"), [{ label: "x", value: swift.num(1) }]))).toBe(
      "Point(x: 1)",
    );
    // Casts bind loosely: a member of one is parenthesized.
    const cast = swift.cast(name("o"), "as!", swift.type("NSString"));
    expect(printExpr(member(cast, "length"))).toBe("(o as! NSString).length");
    expect(printExpr(swift.tryExpr(swift.awaitExpr(call(member(p, "area"), []))))).toBe(
      "try await p.area()",
    );
    expect(printExpr(swift.forceUnwrap(member(p, "value")))).toBe("p.value!");
    expect(printExpr(swift.str('a"b'))).toBe('"a\\"b"');
    expect(printExpr(swift.nil)).toBe("nil");
  });

  it("print array literals and subscripts", () => {
    const cases = swift.arrayLiteral([
      member(name("Palette"), "red"),
      member(name("Palette"), "blue"),
    ]);
    expect(printExpr(swift.index(cases, name("a0")))).toBe("[Palette.red, Palette.blue][a0]");
    expect(
      printExpr(swift.index(swift.cast(name("o"), "as!", swift.type("NSArray")), swift.num(0))),
    ).toBe("(o as! NSArray)[0]");
  });

  it("print tuple literals and their elements", () => {
    const t = name("t");

    expect(printExpr(swift.tupleLiteral([member(t, "1"), member(t, "0")]))).toBe("(t.1, t.0)");
  });

  it("print dictionary literals", () => {
    const entry = (key: string, value: swift.Expr) => ({ key: swift.str(key), value });
    expect(
      printExpr(
        swift.dictionaryLiteral([entry("kind", swift.str("circle")), entry("radius", name("r"))]),
      ),
    ).toBe('["kind": "circle", "radius": r]');
    expect(printExpr(swift.dictionaryLiteral([]))).toBe("[:]");
  });

  it("print closures, inline and trailing", () => {
    const xs = name("xs");
    const box = swift.closure([], [swift.ret(call(name("LucentBox"), [{ value: name("$0") }]))]);
    expect(printExpr(call(member(xs, "map"), [], box))).toBe("xs.map { LucentBox($0) }");
    const two = swift.closure(
      ["r", "e"],
      [swift.exprStmt(call(name("done"), [{ value: name("r") }]))],
    );
    expect(printExpr(call(name("run"), [{ value: two }]))).toBe("run({ r, e in done(r) })");
    // A task on the main actor.
    const task = swift.closure(
      [],
      [
        swift.letStmt("v", swift.awaitExpr(call(name("show"), []))),
        swift.exprStmt(call(name("done"), [{ value: name("v") }])),
      ],
      ["@MainActor"],
    );
    expect(printExpr(call(name("Task"), [], task))).toBe(
      "Task { @MainActor in\n  let v = await show()\n  done(v)\n}",
    );
  });
});

describe("Swift operator precedence", () => {
  const { binary, num } = swift;
  const t = name("t");
  const f = name("f");
  const bo = name("bo");
  const n = name("n");
  const x = name("x");
  const y = name("y");
  const z = name("z");
  const o = name("o");

  /** Each tree, as printed, and what Swift prints for it given `declarations`. */
  const declarations = [
    "let t = true",
    "let f = false",
    "let bo: Bool? = false",
    "let n: Int? = nil",
    "let x: Int?? = .some(nil)",
    "let y: Int? = 2",
    "let z = 3",
    "let o: Any = 5",
  ];
  const cases: { tree: swift.Expr; text: string; value: string }[] = [
    // `??` binds tighter than a comparison.
    { tree: binary(binary(n, "??", num(1)), "==", num(1)), text: "n ?? 1 == 1", value: "true" },
    { tree: binary(bo, "??", binary(t, "==", f)), text: "bo ?? (t == f)", value: "false" },

    // `??` is right-associative: which operand it unwraps changes the value.
    { tree: binary(binary(x, "??", y), "??", z), text: "(x ?? y) ?? z", value: "3" },
    { tree: binary(x, "??", binary(y, "??", z)), text: "x ?? y ?? z", value: "nil" },

    // A comparison is non-associative: `t == f == f` does not compile.
    { tree: binary(binary(t, "==", f), "==", f), text: "(t == f) == f", value: "true" },
    { tree: binary(t, "==", binary(f, "==", f)), text: "t == (f == f)", value: "true" },

    // `&&` binds tighter than `||`, looser than `??`; both are left-associative.
    { tree: binary(t, "&&", binary(bo, "??", t)), text: "t && bo ?? t", value: "false" },
    { tree: binary(binary(f, "&&", f), "||", t), text: "f && f || t", value: "true" },
    { tree: binary(f, "&&", binary(f, "||", t)), text: "f && (f || t)", value: "false" },

    // A cast binds tighter than `??`, looser than a range.
    {
      tree: binary(swift.cast(o, "as?", swift.type("Int")), "??", z),
      text: "o as? Int ?? z",
      value: "5",
    },
    {
      tree: swift.cast(binary(n, "??", z), "as", swift.type("Int")),
      text: "(n ?? z) as Int",
      value: "3",
    },
    {
      tree: binary(binary(n, "??", num(1)), "...", num(2)),
      text: "(n ?? 1) ... 2",
      value: "1...2",
    },

    // A prefix minus binds looser than a member.
    { tree: member(num("-1"), "magnitude"), text: "(-1).magnitude", value: "1" },
  ];

  it("parenthesize by Swift's precedence groups and associativity", () => {
    for (const c of cases) expect(printExpr(c.tree)).toBe(c.text);
  });

  const swiftc =
    process.platform === "darwin" && spawnSync("xcrun", ["--find", "swiftc"]).status === 0;

  it.skipIf(!swiftc)("print what Swift evaluates as the tree", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-swift-precedence-"));
    const source = path.join(dir, "main.swift");
    const bin = path.join(dir, "main");
    const prints = cases.map((c) => `print(String(describing: ${printExpr(c.tree)}))`);
    fs.writeFileSync(source, [...declarations, ...prints, ""].join("\n"));

    const built = spawnSync("xcrun", ["swiftc", "-o", bin, source], {
      encoding: "utf8",
      timeout: 120_000,
    });
    expect(built.status, built.stderr).toBe(0);

    const ran = spawnSync(bin, [], { encoding: "utf8", timeout: 60_000 });
    expect(ran.stdout.trimEnd().split("\n")).toEqual(cases.map((c) => c.value));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("Swift declarations", () => {
  it("print a shim file: imports, a box class and @_cdecl functions", () => {
    const text = swift.printUnit({
      banner: "Generated by Lucent. Do not edit.",
      decls: [
        { k: "import", module: "Foundation" },
        { k: "import", module: "Shapes" },
        {
          k: "class",
          name: "LucentBox",
          typeParams: ["Value"],
          modifiers: ["public", "final"],
          superclass: swift.type("NSObject"),
          protocols: [swift.type("Sendable")],
          members: [
            { k: "var", modifiers: ["public"], name: "value", type: swift.type("Value") },
            {
              k: "init",
              modifiers: ["public"],
              params: [{ external: "_", name: "value", type: swift.type("Value") }],
              body: [swift.exprStmt(swift.assign(member(swift.self, "value"), name("value")))],
            },
            { k: "deinit", body: [swift.exprStmt(call(name("done"), []))] },
          ],
        },
        {
          k: "func",
          attributes: ['@_cdecl("lucent_swift_1a2b")'],
          modifiers: ["public"],
          name: "lucent_swift_1a2b",
          params: [
            { external: "_", name: "self_", type: raw },
            { external: "_", name: "a0", type: raw },
          ],
          ret: swift.type("Double"),
          body: [
            swift.letStmt(
              "s",
              call(name("lucentValue"), [{ value: name("self_") }]),
              swift.type("Point"),
            ),
            {
              k: "guard",
              test: swift.binary(name("a0"), "!=", swift.nil),
              orElse: [swift.ret(swift.num("0"))],
            },
            {
              k: "switch",
              on: name("s"),
              cases: [
                { patterns: [".origin"], body: [swift.ret(swift.num("0"))] },
                { patterns: ["default"], body: [swift.ret(swift.num("1"))] },
              ],
            },
          ],
        },
        {
          k: "func",
          modifiers: [],
          name: "radius",
          params: [{ external: "_", name: "s", type: swift.type("Shape") }],
          ret: swift.type("Double"),
          body: [
            {
              k: "ifCase",
              pattern: "let .circle(p0, p1)",
              value: name("s"),
              body: [swift.ret(name("p1"))],
            },
            swift.ret(swift.num(0)),
          ],
        },
        {
          k: "func",
          modifiers: [],
          name: "safe",
          params: [],
          body: [
            {
              k: "do",
              body: [swift.exprStmt(swift.tryExpr(call(name("risky"), [])))],
              catchBody: [swift.exprStmt(call(name("report"), [{ value: name("error") }]))],
            },
          ],
        },
      ],
    });
    expect(text).toBe(
      [
        "// Generated by Lucent. Do not edit.",
        "import Foundation",
        "import Shapes",
        "",
        "public final class LucentBox<Value>: NSObject, Sendable {",
        "  public var value: Value",
        "",
        "  public init(_ value: Value) {",
        "    self.value = value",
        "  }",
        "",
        "  deinit {",
        "    done()",
        "  }",
        "}",
        "",
        '@_cdecl("lucent_swift_1a2b")',
        "public func lucent_swift_1a2b(_ self_: UnsafeMutableRawPointer, _ a0: UnsafeMutableRawPointer) -> Double {",
        "  let s: Point = lucentValue(self_)",
        "  guard a0 != nil else {",
        "    return 0",
        "  }",
        "  switch s {",
        "  case .origin:",
        "    return 0",
        "  default:",
        "    return 1",
        "  }",
        "}",
        "",
        "func radius(_ s: Shape) -> Double {",
        "  if case let .circle(p0, p1) = s {",
        "    return p1",
        "  }",
        "  return 0",
        "}",
        "",
        "func safe() {",
        "  do {",
        "    try risky()",
        "  } catch {",
        "    report(error)",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("print computed properties, typealiases, throw and inout arguments", () => {
    const text = swift.printUnit({
      decls: [
        {
          k: "class",
          name: "Proxy",
          modifiers: ["final"],
          superclass: swift.type("NSObject"),
          members: [
            { k: "let", modifiers: [], name: "ctx_", type: swift.type("UnsafeMutableRawPointer") },
            { k: "typealias", name: "Item", type: swift.type("String") },
            {
              k: "property",
              modifiers: [],
              name: "name",
              type: swift.type("String"),
              get: [swift.ret(swift.str("n"))],
            },
            {
              k: "property",
              modifiers: [],
              name: "limit",
              type: swift.type("Double"),
              get: [swift.ret(swift.num(1))],
              set: [
                swift.exprStmt(swift.call(swift.name("put"), [{ value: swift.name("newValue") }])),
              ],
            },
            {
              k: "func",
              modifiers: [],
              name: "titles",
              params: [],
              effects: ["throws"],
              ret: swift.array(swift.type("String")),
              body: [
                {
                  k: "var",
                  name: "e_",
                  type: swift.optional(swift.type("UnsafeMutableRawPointer")),
                  init: swift.nil,
                },
                swift.exprStmt(
                  swift.call(swift.name("read"), [{ value: swift.addressOf(swift.name("e_")) }]),
                ),
                {
                  k: "ifLet",
                  name: "e_",
                  value: swift.name("e_"),
                  body: [swift.throwStmt(swift.name("e_"))],
                },
                swift.ret(swift.arrayLiteral([])),
              ],
            },
          ],
        },
      ],
    });

    expect(text).toBe(
      [
        "final class Proxy: NSObject {",
        "  let ctx_: UnsafeMutableRawPointer",
        "  typealias Item = String",
        "",
        "  var name: String {",
        '    return "n"',
        "  }",
        "",
        "  var limit: Double {",
        "    get {",
        "      return 1",
        "    }",
        "    set {",
        "      put(newValue)",
        "    }",
        "  }",
        "",
        "  func titles() throws -> [String] {",
        "    var e_: UnsafeMutableRawPointer? = nil",
        "    read(&e_)",
        "    if let e_ = e_ {",
        "      throw e_",
        "    }",
        "    return []",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("print a SwiftUI view: a struct, property wrappers, an opaque body and a ternary", () => {
    const model = name("model");
    const test = member(model, "on");
    const knob = call(
      name("ZStack"),
      [
        {
          label: "alignment",
          value: swift.conditional(test, name("Alignment.trailing"), name("Alignment.leading")),
        },
      ],
      swift.closure(
        [],
        [
          swift.exprStmt(call(name("Capsule"), [])),
          { k: "if", test, body: [swift.exprStmt(call(name("Circle"), []))] },
        ],
      ),
    );

    // A conditional binds looser than any operator, tighter than an assignment.
    expect(
      printExpr(
        member(swift.conditional(swift.binary(test, "||", name("b")), name("x"), name("y")), "z"),
      ),
    ).toBe("(model.on || b ? x : y).z");
    expect(
      printExpr(
        swift.conditional(test, name("x"), swift.conditional(name("b"), name("y"), name("z"))),
      ),
    ).toBe("model.on ? x : b ? y : z");
    // A closed range binds tighter than a comparison, looser than a member.
    expect(
      printExpr(
        swift.binary(swift.binary(swift.num("-1"), "...", member(model, "max")), "==", name("r")),
      ),
    ).toBe("-1 ... model.max == r");
    expect(
      printExpr(member(swift.binary(swift.num("0"), "...", swift.num("1")), "upperBound")),
    ).toBe("(0 ... 1).upperBound");
    expect(printType(swift.opaque(swift.type("View")))).toBe("some View");

    expect(
      swift.printUnit({
        decls: [
          {
            k: "struct",
            name: "KnobView",
            modifiers: ["fileprivate"],
            protocols: [swift.type("View")],
            members: [
              {
                k: "var",
                modifiers: ["@ObservedObject"],
                name: "model",
                type: swift.type("KnobModel"),
              },
              {
                k: "property",
                modifiers: [],
                name: "body",
                type: swift.opaque(swift.type("View")),
                get: [swift.exprStmt(knob)],
              },
            ],
          },
        ],
      }),
    ).toBe(
      [
        "fileprivate struct KnobView: View {",
        "  @ObservedObject var model: KnobModel",
        "",
        "  var body: some View {",
        "    ZStack(alignment: model.on ? Alignment.trailing : Alignment.leading) {",
        "      Capsule()",
        "      if model.on {",
        "        Circle()",
        "      }",
        "    }",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("print parameters with default values", () => {
    expect(
      swift.printUnit({
        decls: [
          {
            k: "func",
            modifiers: [],
            name: "callAsFunction",
            params: [
              { external: "_", name: "action", type: swift.type("Int32") },
              {
                external: "_",
                name: "args",
                type: swift.array(swift.type("Any")),
                default: swift.arrayLiteral([]),
              },
            ],
            body: [],
          },
        ],
      }),
    ).toContain("func callAsFunction(_ action: Int32, _ args: [Any] = []) {");
  });

  it("print availability checks", () => {
    expect(
      swift.printUnit({
        decls: [
          {
            k: "func",
            modifiers: [],
            name: "host",
            params: [{ name: "controller", type: swift.type("KnobHosting") }],
            body: [
              {
                k: "if",
                test: swift.available("iOS 16.0", "*"),
                body: [
                  swift.exprStmt(
                    swift.assign(
                      member(name("controller"), "sizingOptions"),
                      name(".preferredContentSize"),
                    ),
                  ),
                ],
              },
            ],
          },
        ],
      }),
    ).toBe(
      [
        "func host(controller: KnobHosting) {",
        "  if #available(iOS 16.0, *) {",
        "    controller.sizingOptions = .preferredContentSize",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
  });
});
