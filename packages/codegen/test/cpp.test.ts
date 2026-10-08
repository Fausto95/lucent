import { describe, expect, it } from "vite-plus/test";
import { cpp } from "../src/index.ts";

const { call, id, num, binary, unary, str, printExpr, printStmts } = cpp;
const x = id("x");
const y = id("y");

describe("C++ expressions", () => {
  it("parenthesize by precedence only", () => {
    expect(printExpr(binary(binary(x, "+", y), "*", num("2.0")))).toBe("(x + y) * 2.0");
    expect(printExpr(binary(x, "+", binary(y, "*", num("2.0"))))).toBe("x + y * 2.0");
    // Left-associative: a right operand of the same precedence keeps its parentheses.
    expect(printExpr(binary(x, "-", binary(y, "-", num(1))))).toBe("x - (y - 1)");
    expect(printExpr(binary(binary(x, "-", y), "-", num(1)))).toBe("x - y - 1");
    // C++'s grammar: the last operand of ?: is an assignment-expression.
    expect(printExpr(cpp.conditional(binary(x, "<", y), x, cpp.assign(y, x)))).toBe(
      "x < y ? x : y = x",
    );
    expect(printExpr(cpp.assign(x, cpp.conditional(y, x, y)))).toBe("x = y ? x : y");
    expect(printExpr(cpp.dot(binary(x, "+", y), "size"))).toBe("(x + y).size");
    expect(printExpr(cpp.deref(cpp.postfix("++", x)))).toBe("*x++");
    expect(printExpr(cpp.postfix("++", cpp.deref(x)))).toBe("(*x)++");
  });

  it("parenthesize mixed bitwise, shift and logical operators, as clang's -Wparentheses wants", () => {
    const [a, b, c] = [id("a"), id("b"), id("c")];
    expect(printExpr(binary(binary(a, "&", b), "^", c))).toBe("(a & b) ^ c");
    expect(printExpr(binary(binary(a, "&&", b), "||", c))).toBe("(a && b) || c");
    expect(printExpr(binary(binary(a, "+", b), "<<", c))).toBe("(a + b) << c");
    expect(printExpr(binary(binary(a, "&", b), "&", c))).toBe("a & b & c");
    expect(printExpr(cpp.conditional(binary(a, "+", b), a, b))).toBe("(a + b) ? a : b");
  });

  it("keep unary operators from merging into other tokens", () => {
    expect(printExpr(unary("-", unary("-", x)))).toBe("- -x");
    expect(printExpr(unary("-", num("-1.0")))).toBe("- -1.0");
    expect(printExpr(unary("&", unary("&", x)))).toBe("& &x");
    expect(printExpr(unary("!", unary("-", x)))).toBe("!-x");
  });

  it("print calls, members, casts, construction and template arguments", () => {
    expect(
      printExpr(
        call(cpp.dot(x, "map", true), [y], [cpp.type("lucent::Array", cpp.type("double"))]),
      ),
    ).toBe("x.template map<lucent::Array<double>>(y)");
    expect(printExpr(cpp.arrow(x, "field"))).toBe("x->field");
    expect(printExpr(cpp.staticCast(cpp.type("int32_t"), binary(x, "+", y)))).toBe(
      "static_cast<int32_t>(x + y)",
    );
    expect(printExpr(cpp.cast("bridge", cpp.pointer(cpp.type("NSString")), x))).toBe(
      "(__bridge NSString*)x",
    );
    expect(printExpr(cpp.construct(cpp.type("lucent::Array", cpp.type("double")), [], true))).toBe(
      "lucent::Array<double>{}",
    );
    // A `>` in a template argument would close the list.
    expect(printExpr(call("f", [], [binary(x, ">", y)]))).toBe("f<(x > y)>()");
    expect(
      cpp.printType(cpp.type("lucent::Fn", cpp.fnType(cpp.type("double"), [cpp.type("double")]))),
    ).toBe("lucent::Fn<double(double)>");
    const table = cpp.call(cpp.dot(x, "table"));
    expect(
      cpp.printType(cpp.nestedType(cpp.type("std::decay_t", cpp.decltype(table)), "Iterating")),
    ).toBe("typename std::decay_t<decltype(x.table())>::Iterating");
  });

  it("escape string literals as UTF-8 bytes", () => {
    expect(printExpr(str('a"b\\c'))).toBe('"a\\"b\\\\c"');
    expect(printExpr(str("é?"))).toBe('"\\303\\251\\077"');
    expect(printExpr(cpp.str16("a\ud800"))).toBe('u"\\x61\\xd800"');
  });

  it("print lambdas one statement per line, and simple statement expressions inline", () => {
    const l = cpp.lambda(
      ["y"],
      [cpp.param(cpp.type("double"), "p0")],
      [cpp.ret(binary(id("p0"), "+", y))],
      { ret: cpp.type("double"), mutable: true },
    );
    expect(printExpr(l)).toBe("[y](double p0) mutable -> double {\n  return p0 + y;\n}");
    const init = cpp.lambda(
      [{ name: "f_", init: call("std::move", [id("f")]) }],
      [],
      [cpp.exprStmt(call("f_"))],
    );
    expect(printExpr(init)).toBe("[f_ = std::move(f)]() {\n  f_();\n}");
    const multi = cpp.lambda([], [], [cpp.ifStmt(x, [cpp.ret(y)]), cpp.ret(x)]);
    expect(printStmts([cpp.exprStmt(call("run", [multi]))], "  ")).toBe(
      ["  run([]() {", "    if (x) {", "      return y;", "    }", "    return x;", "  });"].join(
        "\n",
      ),
    );
    expect(
      printExpr(
        cpp.statementExpr([cpp.varDecl(cpp.auto, "v_", call("f"))], binary(id("v_"), "+", num(1))),
      ),
    ).toBe("({ auto v_ = f(); v_ + 1; })");
  });

  it("print Objective-C message sends, blocks and boxed numbers", () => {
    expect(printExpr(cpp.send("UIDevice", "currentDevice"))).toBe("[UIDevice currentDevice]");
    expect(printExpr(cpp.send(x, "setObject:forKey:", [cpp.box(y), str("k")]))).toBe(
      '[x setObject:@(y) forKey:"k"]',
    );
    expect(
      printExpr(
        cpp.blockLiteral(
          [cpp.param(cpp.type("BOOL"), "ok")],
          [cpp.exprStmt(call("done", [id("ok")]))],
        ),
      ),
    ).toBe("^(BOOL ok) { done(ok); }");
  });

  it("name block-typed parameters and variables inside their declarators", () => {
    const done = cpp.blockType(cpp.voidType, [cpp.type("BOOL")]);
    expect(
      printExpr(
        cpp.blockLiteral([cpp.param(done, "a0_")], [cpp.exprStmt(call("a0_", [cpp.id("YES")]))]),
      ),
    ).toBe("^(void (^a0_)(BOOL)) { a0_(YES); }");
    expect(printStmts([cpp.varDecl(done, "b_", id("f"))])).toBe("void (^b_)(BOOL) = f;");
    expect(cpp.printType(done)).toBe("void (^)(BOOL)");
  });
});

describe("C++ statements and declarations", () => {
  it("chain else-if, and print #line directives on their own lines, at column 0", () => {
    expect(printStmts([cpp.block([cpp.lineDirective(4, "/a/b.lucent.ts"), cpp.ret(num(1))])])).toBe(
      ["{", '#line 4 "/a/b.lucent.ts"', "  return 1;", "#line 4", "}"].join("\n"),
    );
    const s = cpp.ifStmt(
      x,
      [cpp.ret(num(1))],
      [cpp.ifStmt(y, [cpp.ret(num(2))], [cpp.ret(num(3))])],
    );
    expect(printStmts([cpp.lineDirective(3, "/a/b.lucent.ts"), s])).toBe(
      [
        '#line 3 "/a/b.lucent.ts"',
        "if (x) {",
        "#line 3",
        "  return 1;",
        "#line 3",
        "} else if (y) {",
        "#line 3",
        "  return 2;",
        "#line 3",
        "} else {",
        "#line 3",
        "  return 3;",
        "#line 3",
        "}",
      ].join("\n"),
    );
  });

  it("name a #line's source line on every line it covers, then the file's own after a function", () => {
    const body = [
      cpp.lineDirective(7, "src/a.lucent.ts"),
      cpp.varDecl(cpp.auto, "f", cpp.lambda([], [], [cpp.ret(num(1))])),
      cpp.ret(id("f")),
    ];
    const unit = cpp.printUnit({
      file: "m_a.cpp",
      decls: [cpp.fn("g", cpp.type("int"), [], body), cpp.fn("h", cpp.type("int"), [], [])],
    });
    const lines = unit.split("\n");

    expect(lines.slice(0, 9)).toEqual([
      "int g() {",
      '#line 7 "src/a.lucent.ts"',
      "  auto f = []() {",
      "#line 7",
      "    return 1;",
      "#line 7",
      "  };",
      "#line 7",
      "  return f;",
    ]);
    // After g, the lines are m_a.cpp's again, numbered as they are in it.
    const reset = lines.findIndex((l) => l.startsWith('#line') && l.includes("m_a.cpp"));
    expect(lines[reset]).toBe(`#line ${reset + 2} "m_a.cpp"`);
    expect(lines.slice(reset + 1)).toEqual(["", "int h() {", "}", ""]);
  });

  it("print variables in each initialization style", () => {
    const t = cpp.type("lucent::Box", cpp.type("double"));
    expect(printStmts([cpp.varDecl(t, "i")])).toBe("lucent::Box<double> i;");
    expect(printStmts([cpp.varDecl(t, "i", x, { style: "construct" })])).toBe(
      "lucent::Box<double> i(x);",
    );
    expect(printStmts([cpp.varDecl(cpp.type("double"), "n", undefined, { style: "brace" })])).toBe(
      "double n{};",
    );
    expect(
      printStmts([cpp.varDecl(cpp.type("jclass"), "cls_", call("find"), { static: true })]),
    ).toBe("static jclass cls_ = find();");
  });

  it("print a unit: includes, namespaces, structs and functions", () => {
    const unit = cpp.printUnit({
      banner: "Generated by Lucent. Do not edit.",
      decls: [
        { k: "pragmaOnce" },
        cpp.include("lucent/lucent.h"),
        {
          k: "namespace",
          name: "lucent_app",
          body: [
            {
              k: "struct",
              name: "S_Point",
              bases: [{ type: cpp.type("lucent::Object") }],
              members: [{ k: "field", type: cpp.type("double"), name: "x" }],
            },
            {
              k: "function",
              name: "twice",
              inline: true,
              ret: cpp.type("double"),
              params: [cpp.param(cpp.type("double"), "v")],
              body: [cpp.ret(binary(id("v"), "*", num("2.0")))],
            },
          ],
        },
      ],
    });
    expect(unit).toBe(
      [
        "// Generated by Lucent. Do not edit.",
        "#pragma once",
        '#include "lucent/lucent.h"',
        "",
        "namespace lucent_app {",
        "",
        "struct S_Point : lucent::Object {",
        "  double x{};",
        "};",
        "",
        "inline double twice(double v) {",
        "  return v * 2.0;",
        "}",
        "",
        "}  // namespace lucent_app",
        "",
      ].join("\n"),
    );
  });

  it("print declarations shielded from macros, restoring them after", () => {
    const huge = cpp.varDecl(cpp.type("double"), "HUGE", num("1e300"));

    const unit = cpp.printUnit({
      decls: [
        cpp.include("math.h", true),
        cpp.withoutMacros(["HUGE", "DOMAIN"], [{ k: "var", stmt: huge }]),
      ],
    });

    expect(unit).toBe(
      [
        "#include <math.h>",
        "",
        '#pragma push_macro("HUGE")',
        "#undef HUGE",
        '#pragma push_macro("DOMAIN")',
        "#undef DOMAIN",
        "",
        "double HUGE = 1e300;",
        "",
        '#pragma pop_macro("DOMAIN")',
        '#pragma pop_macro("HUGE")',
        "",
      ].join("\n"),
    );
  });

  it("print declarations shielded from no macro as they are", () => {
    const body = [cpp.namespace("lucent_app", [])];

    expect(cpp.printDecls([cpp.withoutMacros([], body)])).toBe(cpp.printDecls(body));
  });
});

describe("C++ syntax trees", () => {
  it("refuse to become strings, which would print [object Object] into the code", () => {
    expect(() => `${cpp.id("x")}`).toThrow(/syntax tree \(id\) was used as a string/);
    expect(() => [cpp.id("a"), cpp.id("b")].join(", ")).toThrow(/used as a string/);
  });
});

describe("C++ declarations", () => {
  it("print class templates, virtual bases, inline statics and special members", () => {
    const t = cpp.type("T");
    const decls = cpp.printDecls([
      cpp.struct(
        "C_Box",
        [
          cpp.field(cpp.type("double"), "count", { static: true, inline: true }),
          cpp.field(t, "value"),
          cpp.method("~C_Box", undefined, [], undefined, { virtual: true, default: true }),
          cpp.method("get_value", t, [], undefined, { virtual: true, pure: true }),
          cpp.method("size", cpp.type("double"), [], [cpp.ret(num("1.0"))], { override: true }),
        ],
        {
          template: ["T"],
          bases: [
            { type: cpp.type("lucent::Object") },
            { type: cpp.type("I_Sized"), virtual: true, public: true },
          ],
        },
      ),
      cpp.struct("C_Box", [], { template: ["T"], forward: true }),
    ]);
    expect(decls).toBe(
      [
        "template <class T>",
        "struct C_Box : lucent::Object, public virtual I_Sized {",
        "  static inline double count{};",
        "  T value{};",
        "  virtual ~C_Box() = default;",
        "  virtual T get_value() = 0;",
        "  double size() override {",
        "    return 1.0;",
        "  }",
        "};",
        "",
        "template <class T>",
        "struct C_Box;",
      ].join("\n"),
    );
  });

  it("print members reached through a base class", () => {
    const base = cpp.type("C_Shape", cpp.type("T"));
    expect(printExpr(call(cpp.baseMember(cpp.self, base, "construct"), [x]))).toBe(
      "this->C_Shape<T>::construct(x)",
    );
  });

  it("print out-of-line members and explicit specializations", () => {
    const decls = cpp.printDecls([
      cpp.fn(
        "create",
        cpp.type("lucent::Ref", cpp.type("C_Point")),
        [cpp.param(cpp.type("double"), "a0")],
        undefined,
        { scope: cpp.type("C_Point") },
      ),
      cpp.struct(
        "JsonRead",
        [
          cpp.method("read", cpp.type("double"), [cpp.param(cpp.type("int"), "v")], undefined, {
            static: true,
          }),
        ],
        { template: [], args: [cpp.type("double")] },
      ),
      cpp.fn(
        "read",
        cpp.type("double"),
        [cpp.param(cpp.type("int"), "v")],
        [
          cpp.ret(
            cpp.call(cpp.scoped(cpp.type("JsonRead", cpp.type("double")), "read"), [
              cpp.templateId("std::in_place_type", [cpp.type("double")]),
            ]),
          ),
        ],
        { inline: true, scope: cpp.type("JsonRead", cpp.type("double")) },
      ),
      cpp.namespace("m_main", [cpp.fn("init", cpp.voidType, [], [])]),
    ]);
    expect(decls).toBe(
      [
        "lucent::Ref<C_Point> C_Point::create(double a0);",
        "",
        "template <>",
        "struct JsonRead<double> {",
        "  static double read(int v);",
        "};",
        "",
        "inline double JsonRead<double>::read(int v) {",
        "  return JsonRead<double>::read(std::in_place_type<double>);",
        "}",
        "",
        "namespace m_main {",
        "",
        "void init() {",
        "}",
        "",
        "}  // namespace m_main",
      ].join("\n"),
    );
  });

  it("print anonymous namespaces, using-directives, arrays and declaring conditions", () => {
    const d = id("d");
    const decls = cpp.printDecls([
      cpp.namespace("", [
        { k: "usingNamespace", name: "lucent::js" },
        {
          k: "var",
          stmt: {
            ...cpp.varDecl(
              cpp.constType(cpp.type("ModuleDef")),
              "kModules",
              cpp.initList([cpp.initList([cpp.str("main"), id("install_main")])]),
            ),
            array: true,
          },
        },
      ]),
      cpp.fn(
        "pick",
        cpp.type("int"),
        [],
        [
          {
            k: "if",
            bind: { type: cpp.auto, name: "d" },
            test: call("find"),
            body: [cpp.ret(d)],
          },
          cpp.ret(num(0)),
        ],
      ),
    ]);
    expect(decls).toBe(
      [
        "namespace {",
        "",
        "using namespace lucent::js;",
        "",
        'const ModuleDef kModules[] = {{"main", install_main}};',
        "",
        "}  // namespace",
        "",
        "int pick() {",
        "  if (auto d = find()) {",
        "    return d;",
        "  }",
        "  return 0;",
        "}",
      ].join("\n"),
    );
  });

  it("print inherited constructors and comments among members", () => {
    const decls = cpp.printDecls([
      cpp.struct(
        "Emitter",
        [
          { k: "access", level: "public" },
          { k: "using", name: "ViewEventEmitter::ViewEventEmitter" },
          { k: "comment", text: "onChange" },
          cpp.method("emit", cpp.voidType, [cpp.param(cpp.type("Event0"), "event")], undefined, {
            const: true,
          }),
        ],
        { bases: [{ type: cpp.type("ViewEventEmitter"), public: true }], final: true },
      ),
    ]);

    expect(decls).toBe(
      [
        "struct Emitter final : public ViewEventEmitter {",
        " public:",
        "  using ViewEventEmitter::ViewEventEmitter;",
        "  // onChange",
        "  void emit(Event0 event) const;",
        "};",
      ].join("\n"),
    );
  });

  it("print out-of-line constructors with their initializers, and const members", () => {
    const props = cpp.type("Props");
    const decls = cpp.printDecls([
      {
        k: "function",
        name: "Props",
        scope: props,
        ret: cpp.voidType,
        ctor: true,
        params: [cpp.param(cpp.reference(cpp.constType(props)), "source")],
        initializers: [{ name: "ViewProps", args: [cpp.id("source")] }],
        body: [],
      },
      {
        k: "function",
        name: "emit",
        scope: cpp.type("EventEmitter"),
        ret: cpp.voidType,
        const: true,
        params: [],
        body: [cpp.exprStmt(call("send"))],
      },
    ]);

    expect(decls).toBe(
      [
        "Props::Props(const Props& source) : ViewProps(source) {",
        "}",
        "",
        "void EventEmitter::emit() const {",
        "  send();",
        "}",
      ].join("\n"),
    );
  });
});
