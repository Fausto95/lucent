import { beforeAll, describe, expect, it } from "vite-plus/test";
import {
  compileErrors,
  compiles,
  hostRun,
  iosProgram,
  prepareSwiftModules,
  xcode,
} from "./swift-harness.ts";

/** A program's iOS output, compiled against the Shapes fixture module. */
const shapes = (src: string) => iosProgram(src, ["Shapes"]);

const synchronous = `import { Canvas, Checksum, Counter, Palette, Pen, Point, Token } from "lucent:ios/Shapes";
export async function run(): Promise<string> {
  const p = new Point(3, 4);
  p.x = 6;
  const d = p.distance(Point.origin);
  const pen = new Pen(Palette.green);
  pen.label = "fine";
  const mixed = pen.mix(Palette.blue) === Palette.blue;
  const line = pen.stroke(p, Point.origin);
  const counter = new Counter();
  counter.increment();
  let failed = false;
  try {
    Pen.parse("mauve");
  } catch (e) {
    failed = true;
  }
  const sum = Checksum.of(new Uint8Array([1, 2, 3]));
  const joined = Checksum.joined(["a", "b"]);
  const bytes = new Token().bytes;
  return \`\${d} \${pen.color} \${pen.label} \${mixed} \${line.length} \${counter.count} \${failed} \${sum} \${joined} \${bytes.length} \${new Canvas().shapes.length}\`;
}
`;

const asynchronous = `import { Canvas, Screen, fetch, greet } from "lucent:ios/Shapes";
import { main } from "lucent:thread";
export async function run(): Promise<string> {
  const area = await new Canvas().area();
  const points = await fetch(2n);
  let failed = false;
  try {
    await fetch(-1n);
  } catch (e) {
    failed = true;
  }
  const screen = await main(() => new Screen());
  const shown = await screen.show("settings");
  const ready = await screen.ready;
  const title = await main(() => screen.title);
  const greetings = (await greet("a")) + (await greet("b", "?"));
  return \`\${area} \${points.length} \${points[0]!.x} \${failed} \${shown} \${ready} \${title} \${greetings}\`;
}
`;

const unions = `import { Canvas, Palette, Pen, Point, Shape } from "lucent:ios/Shapes";
export async function run(): Promise<string> {
  const canvas = new Canvas();
  canvas.add({ kind: "circle", center: new Point(1, 2), radius: 3 });
  canvas.add({ kind: "square", side: 2 });
  const shapes: Shape[] = canvas.shapes;
  let described = "";
  for (const s of shapes) described += s.kind === "circle" ? \`c\${s.radius}@\${s.center.x}\` : \`s\${s.side}\`;
  const pen = new Pen(Palette.red);
  pen.outline = { kind: "dashed", _0: 1, _1: 2 };
  const o = pen.outline;
  const none = new Pen(Palette.blue).outline.kind;
  pen.outline = { kind: "custom", name: null, width: 3 };
  const custom = pen.outline;
  const unnamed = custom.kind === "custom" && custom.name === null ? custom.width : 0;
  return \`\${described} \${o.kind === "dashed" ? o._0 + o._1 : 0} \${none} \${unnamed}\`;
}
`;

const generics = `import {
  Box,
  Key,
  Point,
  Summer,
  Uses,
  attempt,
  countNames,
  identity,
  midpoint,
  read,
  verify,
} from "lucent:ios/Shapes";
export async function run(): Promise<string> {
  const n = identity(2);
  const s = identity("two");
  const box = new Box(new Point(1, 2));
  const inner = box.value.x;
  box.value = new Point(3, 4);
  const b = new Uses().boxed().value.y;
  const o = attempt(true);
  const total = Summer.total(3n) + new Summer(new Uint8Array(2)).output();
  const v = verify(false);
  const why = v.kind === "unverified" ? v._1 : -1n + countNames(["a", "b"]);
  const key = read(Key.area);
  const mid = midpoint({ x: 0, y: 0 }, { x: 2, y: 4 });
  return \`\${n} \${s} \${inner} \${box.value.x} \${b} \${o.kind === "done" ? o.value : -1} \${total} \${why} \${key} \${mid.y}\`;
}
`;

const protocols = `import { Drawable, favorite, render } from "lucent:ios/Shapes";
class Star implements Drawable {
  points = 5;
  draw(): string {
    return \`star \${this.points}\`;
  }
}
export async function run(): Promise<string> {
  const star = new Star();
  const mine = render(star);
  const theirs = favorite();
  return \`\${mine} \${render(theirs)} \${theirs.draw()} \${render(star) === mine}\`;
}
`;

/** A program's iOS output against the SDK alone (no fixture module). */
const sdk = (src: string) => iosProgram(src);

const cryptoKit = `import { AES_GCM, P256_Signing_PrivateKey, SHA256, SymmetricKey, SymmetricKeySize } from "lucent:ios/CryptoKit";
export async function run(): Promise<string> {
  const digest = SHA256.hash(new Uint8Array([97, 98, 99])).bytes;
  const key = new SymmetricKey(SymmetricKeySize.bits256);
  const box = AES_GCM.seal(new Uint8Array([1, 2, 3]), key, null);
  const opened = AES_GCM.open(box, key);
  const signer = new P256_Signing_PrivateKey(true);
  const signature = signer.signature(new Uint8Array([4, 5]));
  const valid = signer.publicKey.isValidSignature(signature, new Uint8Array([4, 5]));
  return \`\${digest.length} \${opened.length} \${valid}\`;
}
`;

const storeKit = `import { Product, Transaction } from "lucent:ios/StoreKit";
export async function run(): Promise<string> {
  const products = await Product.products(["lucent.coins"]);
  let bought = "";
  for (const p of products) {
    // Main-actor, and async: it hops to the main thread itself.
    const result = await p.purchase();
    bought += result.kind;
  }
  const latest = await Transaction.latest("lucent.coins");
  return \`\${products.length} \${bought} \${latest === null ? "none" : latest.kind}\`;
}
`;

const avFoundation = `import { AVPartialAsyncProperty, AVURLAsset } from "lucent:ios/AVFoundation";
import { NSURL } from "lucent:ios/Foundation";
export async function run(): Promise<string> {
  const asset = new AVURLAsset(new NSURL("file:///tmp/clip.m4a"), null);
  const duration = await asset.load(AVPartialAsyncProperty.duration);
  return \`\${Number(duration.value) / duration.timescale}\`;
}
`;

describe.skipIf(!xcode)("Swift-only SDK APIs", () => {
  it.each([
    ["CryptoKit", cryptoKit],
    ["StoreKit 2", storeKit],
    ["AVFoundation's load(_:)", avFoundation],
  ])(
    "calls %s through shims that compile",
    (_, src) => {
      expect(compileErrors(sdk(src))).toEqual(compiles);
    },
    300_000,
  );
});

describe.skipIf(!xcode)("Swift-only members, called through shims", () => {
  beforeAll(() => prepareSwiftModules(["Shapes"]), 300_000);

  it("calls synchronous members through one @_cdecl shim each", () => {
    const { r, mm, shims } = shapes(synchronous);
    expect(r.diagnostics).toEqual([]);
    // One shim per member used, however often: Point.origin is read twice.
    const symbols = [...shims.matchAll(/@_cdecl\("(lucent_swift_\w+)"\)/g)].map((m) => m[1]);
    expect(symbols).toHaveLength(21);
    expect(new Set(symbols).size).toBe(symbols.length);
    expect(shims).toContain("import Shapes");
    // Calls written from the Swift names, labels included.
    expect(shims).toContain(".distance(to: ");
    expect(shims).toContain(".stroke(from: ");
    expect(shims).toContain("Shapes.Point(x: a0, y: a1)");
    expect(shims).toContain("Shapes.Checksum.of(");
    // Structs cross boxed, and change in place through their box.
    expect(shims).toContain("as! LucentBox<Shapes.Point>).value.x = a0");
    expect(shims).toContain("as! LucentBox<Shapes.Counter>).value.increment()");
    // Enums without payloads cross as their cases' indexes.
    expect(shims).toContain("[Shapes.Palette.red, Shapes.Palette.green, Shapes.Palette.blue][a0]");
    // Errors cross as NSError.
    expect(shims).toContain("try Shapes.Pen.parse(");
    expect(shims).toContain("as NSError");
    // The glue declares what it calls, and imports no header for Swift-only modules.
    for (const s of new Set(symbols)) expect(mm).toContain(s!);
    expect(mm).toContain('extern "C"');
    expect(mm).not.toContain("Shapes/");
    expect(mm).toContain("lucent::objc::throwIfError(");
    expect(r.frameworks).not.toContain("Shapes");
  }, 180_000);

  it("generates shims and glue that compile, without warnings", () => {
    expect(compileErrors(shapes(synchronous))).toEqual(compiles);
  }, 120_000);

  it("awaits async members: a promise the shim's task settles", () => {
    const r = shapes(asynchronous);
    const { mm, shims } = r;
    expect(r.r.diagnostics).toEqual([]);
    // Arguments are read before the task (they are borrowed for the call only).
    expect(shims).toMatch(
      /let o_ = lucentObject\(self_\) as! Shapes\.Canvas\n\s*let task = Task \{/,
    );
    // The task goes back to the glue, which cancels it when the operation ends.
    expect(shims).toContain("return lucentRetained(LucentTask(task))");
    expect(shims).toContain('@_cdecl("lucent_swift_cancel")');
    expect(shims).toContain("let v = try await o_.area()");
    expect(shims).toContain("let v = try await Shapes.fetch(a0)");
    expect(shims).toContain("done_(ctx_, ");
    // Main-actor members: synchronous ones run on the main thread, async ones hop to it.
    expect(shims).toMatch(
      /@MainActor\npublic func lucent_swift_\w+\(_ self_: UnsafeMutableRawPointer\) -> UnsafeMutableRawPointer \{\n\s*let v = \(lucentObject\(self_\) as! Shapes\.Screen\)\.title/,
    );
    expect(shims).toContain("Task { @MainActor in");
    // Default arguments left out: a shim per number of arguments.
    expect(shims).toContain("await Shapes.greet(v0)");
    expect(shims).toContain("await Shapes.greet(v0, punctuation: v1)");
    expect(shims).toContain("let v = await o_.ready");
    // The glue settles the calling context's operation on the Lucent thread.
    expect(mm).toContain("lucent::nativeOperation<");
    expect(mm).toContain("lucent::postCallback(");
    expect(compileErrors(r)).toEqual(compiles);
  }, 120_000);

  it("passes enums with payloads as unions: a dictionary of the case and its payload", () => {
    const r = shapes(unions);
    const { shims } = r;
    expect(r.r.diagnostics).toEqual([]);
    // Swift makes the dictionary case by case, and the value from it.
    expect(shims).toContain("if case let .circle(p0, p1) = v {");
    expect(shims).toContain('"kind": "circle"');
    expect(shims).toContain("Shapes.Shape.circle(center: ");
    expect(shims).toContain("Shapes.Stroke.dashed(");
    expect(shims).toContain("Shapes.Stroke.none");
    // Optional payloads: absent from the dictionary.
    expect(shims).toContain('"name": p0.map { $0 as NSString } as Any');
    expect(compileErrors(r)).toEqual(compiles);
  }, 120_000);

  it("specializes generics per use: one shim per combination of type arguments", () => {
    const r = shapes(generics);
    const { shims } = r;
    expect(r.r.diagnostics).toEqual([]);
    // identity used with two type arguments: two shims.
    expect(shims).toMatch(/_ a0: Double\) -> Double \{\n\s*let v: Double = Shapes\.identity\(a0\)/);
    expect(shims).toMatch(/let v: String = Shapes\.identity\(lucentObject\(a0\) as! String\)/);
    // Members of generic types, on the type arguments the receiver has.
    expect(shims).toContain("Shapes.Box<Shapes.Point>(value: ");
    expect(shims).toContain("as! LucentBox<Shapes.Box<Shapes.Point>>).value.value = ");
    // Generic enums with payloads, specialized.
    expect(shims).toContain(
      "func lucentObject_Shapes_Outcome_Double_(_ v: Shapes.Outcome<Double>)",
    );
    // Protocol extensions' members, on the conforming type.
    expect(shims).toContain("Shapes.Summer.total(of: a0)");
    expect(shims).toContain("Shapes.countNames(lucentObject(a0) as! [String])");
    // Statics of generic types, on the type arguments their extension fixes.
    expect(shims).toContain("Shapes.Key<Shapes.Canvas>.area");
    // C structs cross as their bytes.
    expect(shims).toContain(".loadUnaligned(as: ");
    expect(shims).toContain("withUnsafeBytes(of: v) { Data($0) }");
    expect(compileErrors(r)).toEqual(compiles);
  }, 120_000);

  it("passes protocol values, and Lucent classes implementing Swift protocols", () => {
    const r = shapes(protocols);
    const { shims } = r;
    expect(r.r.diagnostics).toEqual([]);
    // Protocol values are objects: Swift classes, or Swift's boxes for other values.
    expect(shims).toContain("lucentObject(a0) as! any Shapes.Drawable");
    expect(shims).toContain("(lucentObject(self_) as! any Shapes.Drawable).draw()");
    // A Lucent class conforms through a Swift class that calls back into the glue.
    expect(shims).toMatch(/final class LucentProxy_\w+: NSObject, Shapes\.Drawable \{/);
    expect(shims).toContain("deinit {");
    expect(compileErrors(r)).toEqual(compiles);
  }, 120_000);

  it("runs on the host: Swift values, errors and a Lucent class conforming to a Swift protocol", () => {
    expect(hostRun(shapes(synchronous))).toMatchObject({
      status: 0,
      stdout: "7.211102550927978 1 fine true 2 1 true 3 ab 4 0\n",
    });
    expect(hostRun(shapes(protocols))).toMatchObject({
      status: 0,
      stdout: "star 5 circle circle true\n",
    });
  }, 600_000);

  it("implements a protocol with an associated type, which the class fixes", () => {
    const r = shapes(`import type { Container } from "lucent:ios/Shapes";
class Bag implements Container<string> {
  first(): string | null {
    return "a";
  }
}
export async function run(): Promise<string> {
  return \`\${new Bag().first()}\`;
}
`);

    expect(r.r.diagnostics).toEqual([]);
    expect(r.shims).toContain("typealias Item = String");
    expect(compileErrors(r)).toEqual(compiles);
  }, 120_000);
});
