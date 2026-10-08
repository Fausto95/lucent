/**
 * What the JavaScript library and Lucent's built-in modules do when
 * called: the language's own semantics, the same on every platform. A
 * member missing here has unknown effects.
 */
import path from "node:path";
import ts from "typescript";
import { builtinSdkModuleOf, coreTypesPath, isLibFile } from "../program.ts";

export interface LibraryEffect {
  /** It mutates its receiver. */
  readonly mutates?: true;
  readonly allocates?: true;
  readonly throws?: true;
  /** The function arguments it calls: all of them, while the call runs or later on the caller's context. */
  readonly calls?: "during" | "later";
  /** It runs its first argument on the main thread (lucent:thread's main). */
  readonly main?: true;
  /** It runs its first argument on a compute worker, given a copy of the second (lucent:core's compute). */
  readonly task?: true;
  /** It keeps its arguments: in its receiver, or in the value it returns. */
  readonly keeps?: "receiver" | "result";
  /**
   * What it returns: its receiver itself (or a view of the same storage),
   * a new object holding its receiver's elements, or one of them. Anything
   * else it allocates is new.
   */
  readonly result?: "receiver" | "copy" | "element";
  /** It starts work that continues later (a promise, a timer). */
  readonly schedules?: true;
  /** It iterates its first argument: an iterator there runs its code. */
  readonly iterates?: true;
  /** The functions it gives the callbacks it calls settle a promise (a Promise executor's). */
  readonly settles?: true;
}

const NONE: LibraryEffect = {};
const ALLOCATES: LibraryEffect = { allocates: true };
const ALLOCATES_THROWS: LibraryEffect = { allocates: true, throws: true };
const VISITS: LibraryEffect = { calls: "during" };
const FINDS: LibraryEffect = { calls: "during", result: "element" };
const ELEMENT: LibraryEffect = { result: "element" };
const COPY: LibraryEffect = { allocates: true, result: "copy" };
const MUTATES: LibraryEffect = { mutates: true };
const ADDS: LibraryEffect = { mutates: true, keeps: "receiver", result: "receiver" };
const TAKES: LibraryEffect = { mutates: true, result: "element" };
const REORDERS: LibraryEffect = { mutates: true, result: "receiver" };
const MAPS: LibraryEffect = { calls: "during", allocates: true };
const MAKES: LibraryEffect = { allocates: true, keeps: "result" };
const COLLECTS: LibraryEffect = { allocates: true, keeps: "result", iterates: true };
const PROMISE: LibraryEffect = {
  allocates: true,
  schedules: true,
  keeps: "result",
  iterates: true,
};
const CONTINUES: LibraryEffect = { allocates: true, schedules: true, calls: "later" };

/** Date's getters (each also as `getUTC…`), and its setters. */
const DATE_FIELDS = [
  "FullYear",
  "Month",
  "Date",
  "Day",
  "Hours",
  "Minutes",
  "Seconds",
  "Milliseconds",
];
const DATE_READS = [
  "getTime",
  "getTimezoneOffset",
  "valueOf",
  ...DATE_FIELDS.flatMap((f) => [`get${f}`, `getUTC${f}`]),
];
const DATE_WRITES = [
  "setTime",
  ...DATE_FIELDS.filter((f) => f !== "Day").flatMap((f) => [`set${f}`, `setUTC${f}`]),
];

const DATE_TEXTS = [
  "toJSON",
  "toString",
  "toUTCString",
  "toDateString",
  "toTimeString",
  "toLocaleString",
  "toLocaleDateString",
  "toLocaleTimeString",
];

/** Members by owner (the interface declaring them, as normalized below) and name. */
const LIBRARY: Record<string, LibraryEffect> = {
  "Array.at": ELEMENT,
  "Array.concat": { allocates: true, keeps: "result", result: "copy" },
  "Array.copyWithin": REORDERS,
  "Array.entries": COPY,
  "Array.every": VISITS,
  "Array.fill": ADDS,
  "Array.filter": { calls: "during", allocates: true, result: "copy" },
  "Array.find": FINDS,
  "Array.findIndex": VISITS,
  "Array.findLast": FINDS,
  "Array.findLastIndex": VISITS,
  "Array.flat": COPY,
  "Array.flatMap": MAPS,
  "Array.forEach": VISITS,
  "Array.includes": NONE,
  "Array.indexOf": NONE,
  "Array.join": ALLOCATES,
  "Array.keys": ALLOCATES,
  "Array.lastIndexOf": NONE,
  "Array.map": MAPS,
  "Array.pop": TAKES,
  "Array.push": { mutates: true, keeps: "receiver" },
  "Array.reduce": FINDS,
  "Array.reduceRight": FINDS,
  "Array.reverse": REORDERS,
  "Array.shift": TAKES,
  "Array.slice": COPY,
  "Array.some": VISITS,
  "Array.sort": { mutates: true, calls: "during", result: "receiver" },
  "Array.splice": { mutates: true, allocates: true, keeps: "receiver", result: "copy" },
  "Array.toReversed": COPY,
  "Array.toSorted": { calls: "during", allocates: true, result: "copy" },
  "Array.toSpliced": { allocates: true, keeps: "result", result: "copy" },
  "Array.toString": ALLOCATES,
  "Array.unshift": { mutates: true, keeps: "receiver" },
  "Array.values": COPY,
  "Array.with": { allocates: true, keeps: "result", result: "copy" },
  "ArrayConstructor.from": { calls: "during", allocates: true, keeps: "result", iterates: true },
  "ArrayConstructor.isArray": NONE,
  "ArrayConstructor.new": { allocates: true, throws: true, keeps: "result" },
  "ArrayConstructor.of": MAKES,

  "Map.clear": MUTATES,
  "Map.delete": MUTATES,
  "Map.entries": COPY,
  "Map.forEach": VISITS,
  "Map.get": ELEMENT,
  "Map.has": NONE,
  "Map.keys": COPY,
  "Map.set": ADDS,
  "Map.values": COPY,
  "MapConstructor.new": COLLECTS,

  "Set.add": ADDS,
  "Set.clear": MUTATES,
  "Set.delete": MUTATES,
  "Set.entries": COPY,
  "Set.forEach": VISITS,
  "Set.has": NONE,
  "Set.keys": COPY,
  "Set.values": COPY,
  "SetConstructor.new": COLLECTS,

  "Uint8Array.at": NONE,
  "Uint8Array.fill": REORDERS,
  "Uint8Array.forEach": VISITS,
  "Uint8Array.includes": NONE,
  "Uint8Array.indexOf": NONE,
  "Uint8Array.join": ALLOCATES,
  "Uint8Array.map": MAPS,
  "Uint8Array.reduce": VISITS,
  "Uint8Array.set": { mutates: true, throws: true },
  "Uint8Array.slice": ALLOCATES,
  // A view of the same bytes.
  "Uint8Array.subarray": { allocates: true, result: "receiver" },
  "Uint8Array.toString": ALLOCATES,
  "Uint8ArrayConstructor.new": { allocates: true, throws: true },

  "String.at": ALLOCATES,
  "String.charAt": ALLOCATES,
  "String.charCodeAt": NONE,
  "String.codePointAt": NONE,
  "String.concat": ALLOCATES,
  "String.endsWith": NONE,
  "String.includes": NONE,
  "String.indexOf": NONE,
  "String.lastIndexOf": NONE,
  "String.localeCompare": NONE,
  "String.match": ALLOCATES,
  "String.matchAll": ALLOCATES,
  "String.normalize": ALLOCATES_THROWS,
  "String.padEnd": ALLOCATES,
  "String.padStart": ALLOCATES,
  "String.repeat": ALLOCATES_THROWS,
  "String.replace": MAPS,
  "String.replaceAll": MAPS,
  "String.search": NONE,
  "String.slice": ALLOCATES,
  "String.split": ALLOCATES,
  "String.startsWith": NONE,
  "String.substr": ALLOCATES,
  "String.substring": ALLOCATES,
  "String.toLocaleLowerCase": ALLOCATES,
  "String.toLocaleUpperCase": ALLOCATES,
  "String.toLowerCase": ALLOCATES,
  "String.toString": NONE,
  "String.toUpperCase": ALLOCATES,
  "String.trim": ALLOCATES,
  "String.trimEnd": ALLOCATES,
  "String.trimLeft": ALLOCATES,
  "String.trimRight": ALLOCATES,
  "String.trimStart": ALLOCATES,
  "String.valueOf": NONE,
  "StringConstructor.call": ALLOCATES,
  "StringConstructor.fromCharCode": ALLOCATES,
  "StringConstructor.fromCodePoint": ALLOCATES_THROWS,

  "Number.toExponential": ALLOCATES_THROWS,
  "Number.toFixed": ALLOCATES_THROWS,
  "Number.toPrecision": ALLOCATES_THROWS,
  "Number.toString": ALLOCATES_THROWS,
  "NumberConstructor.call": NONE,
  "NumberConstructor.isFinite": NONE,
  "NumberConstructor.isInteger": NONE,
  "NumberConstructor.isNaN": NONE,
  "NumberConstructor.isSafeInteger": NONE,
  "NumberConstructor.parseFloat": NONE,
  "NumberConstructor.parseInt": NONE,
  "Number.valueOf": NONE,
  "BooleanConstructor.call": NONE,
  "Boolean.valueOf": NONE,

  isFinite: NONE,
  isNaN: NONE,
  parseFloat: NONE,
  parseInt: NONE,

  // They throw on a fraction or text that is no integer, a radix or bit count
  // out of range, a result too large.
  "BigInt.toString": ALLOCATES_THROWS,
  "BigInt.valueOf": NONE,
  "BigIntConstructor.asIntN": ALLOCATES_THROWS,
  "BigIntConstructor.asUintN": ALLOCATES_THROWS,
  "BigIntConstructor.call": ALLOCATES_THROWS,

  "Math.abs": NONE,
  "Math.acos": NONE,
  "Math.acosh": NONE,
  "Math.asin": NONE,
  "Math.asinh": NONE,
  "Math.atan": NONE,
  "Math.atan2": NONE,
  "Math.atanh": NONE,
  "Math.cbrt": NONE,
  "Math.ceil": NONE,
  "Math.clz32": NONE,
  "Math.cos": NONE,
  "Math.cosh": NONE,
  "Math.exp": NONE,
  "Math.expm1": NONE,
  "Math.floor": NONE,
  "Math.fround": NONE,
  "Math.hypot": NONE,
  "Math.imul": NONE,
  "Math.log": NONE,
  "Math.log10": NONE,
  "Math.log1p": NONE,
  "Math.log2": NONE,
  "Math.max": NONE,
  "Math.min": NONE,
  "Math.pow": NONE,
  // Per-thread generator state in the runtime.
  "Math.random": NONE,
  "Math.round": NONE,
  "Math.sign": NONE,
  "Math.sin": NONE,
  "Math.sinh": NONE,
  "Math.sqrt": NONE,
  "Math.tan": NONE,
  "Math.tanh": NONE,
  "Math.trunc": NONE,

  "JSON.parse": ALLOCATES_THROWS,
  "JSON.stringify": ALLOCATES_THROWS,
  "ObjectConstructor.entries": MAKES,
  "ObjectConstructor.fromEntries": COLLECTS,
  "ObjectConstructor.keys": ALLOCATES,
  "ObjectConstructor.values": MAKES,
  // The value's text, as String(x) gives it: no code of the program runs.
  "Object.toString": ALLOCATES,
  "Function.toString": ALLOCATES,

  "Console.debug": NONE,
  "Console.error": NONE,
  "Console.info": NONE,
  "Console.log": NONE,
  "Console.warn": NONE,

  ...Object.fromEntries(DATE_READS.map((m) => [`Date.${m}`, NONE])),
  ...Object.fromEntries(DATE_WRITES.map((m) => [`Date.${m}`, MUTATES])),
  "Date.toISOString": ALLOCATES_THROWS,
  ...Object.fromEntries(DATE_TEXTS.map((m) => [`Date.${m}`, ALLOCATES])),
  "DateConstructor.UTC": NONE,
  "DateConstructor.new": ALLOCATES,
  "DateConstructor.now": NONE,
  "DateConstructor.parse": NONE,

  "ErrorConstructor.call": ALLOCATES,
  "ErrorConstructor.new": ALLOCATES,
  "RangeErrorConstructor.call": ALLOCATES,
  "RangeErrorConstructor.new": ALLOCATES,
  "TypeErrorConstructor.call": ALLOCATES,
  "TypeErrorConstructor.new": ALLOCATES,
  "RegExp.exec": ALLOCATES,
  "RegExp.test": NONE,
  "RegExpConstructor.new": ALLOCATES_THROWS,

  "Promise.catch": CONTINUES,
  "Promise.finally": CONTINUES,
  "Promise.then": CONTINUES,
  "PromiseConstructor.all": PROMISE,
  // The executor runs at once, given the functions that settle the promise.
  "PromiseConstructor.new": { allocates: true, schedules: true, calls: "during", settles: true },
  "PromiseConstructor.reject": PROMISE,
  "PromiseConstructor.resolve": PROMISE,

  "AbortController.new": ALLOCATES,
  "AbortSignal.addEventListener": { calls: "later", keeps: "receiver" },
  "AbortSignal.throwIfAborted": { throws: true },

  "lucent:core.compute": { allocates: true, schedules: true, task: true },
  "lucent:core.NativeBuffer.allocate": ALLOCATES_THROWS,
  "lucent:core.NativeBuffer.from": ALLOCATES,
  "lucent:core.NativeBuffer.stats": ALLOCATES,
  // A borrow: the callback runs now, and what it returns is the call's.
  "lucent:core.NativeBuffer.withRead": { calls: "during", throws: true },
  "lucent:core.NativeBuffer.withWrite": { calls: "during", mutates: true, throws: true },
  "lucent:core.NativeBuffer.toUint8Array": ALLOCATES_THROWS,
  "lucent:core.NativeBuffer.transfer": { mutates: true, allocates: true, throws: true },
  "lucent:core.NativeBuffer.close": { mutates: true, throws: true },
  "lucent:core.NativeBuffer.[Symbol.dispose]": { mutates: true, throws: true },
  // Not the receiver back, unlike Uint8Array's: a span never leaves its borrow.
  "lucent:core.MutableByteSpan.fill": MUTATES,
  "lucent:core.MutableByteSpan.set": { mutates: true, throws: true },
  "lucent:core.EventEmitter.new": ALLOCATES,
  "lucent:core.EventEmitter.addListener": { mutates: true, allocates: true, keeps: "receiver" },
  // emit runs the listeners: code of any effect (it is not listed).
  "lucent:core.EventEmitter.listenerCount": NONE,
  "lucent:core.EventEmitter.removeAllListeners": MUTATES,
  "lucent:core.EventSubscription.remove": MUTATES,
  "lucent:core.delay": { allocates: true, schedules: true },
  "lucent:core.error": ALLOCATES,
  "lucent:core.errorCode": NONE,
  "lucent:core.now": NONE,
  "lucent:core.utf8Decode": ALLOCATES,
  "lucent:core.utf8Encode": ALLOCATES,
  "lucent:thread.main": { allocates: true, schedules: true, main: true },
  "lucent:android.appContext": NONE,
  "lucent:android.available": NONE,
  "lucent:android.errorOf": ALLOCATES,
  "lucent:ios.available": NONE,
  // lucent:ui (a component's setup, on the main thread): effect and
  // onDispose keep their argument for later, there.
  "lucent:ui.effect": { allocates: true, calls: "later" },
  "lucent:ui.onDispose": { calls: "later" },
  // The host measures the component again, later.
  "lucent:ui.invalidateSize": { schedules: true },
  "lucent:ui.signal": MAKES,
  "lucent:ui.Signal.get": NONE,
  "lucent:ui.Signal.peek": NONE,
  "lucent:ui.Signal.set": { mutates: true, keeps: "receiver" },
  // A body's view reads and writes the signal later, on the main thread.
  "lucent:ui.bind": { keeps: "result" },
  "lucent:ui.range": NONE,

  // lucent:swiftui: withAnimation runs its body at once, on the main thread.
  "lucent:swiftui.withAnimation": { calls: "during" },
};

/**
 * What every other member of a built-in module does. A SwiftUI view,
 * modifier or value only describes a body, which SwiftUI draws later: the
 * actions it is given run then, on the main thread. Compose's are its
 * content's, which composes later on the main thread (setup code using
 * one is refused as it is compiled).
 */
const MODULE_DEFAULTS: Record<string, LibraryEffect> = {
  "lucent:swiftui": { allocates: true, keeps: "result", calls: "later" },
  "lucent:compose": { allocates: true, keeps: "result", calls: "later" },
};

/** Interfaces whose members are another's: a readonly view's are the collection's. */
const OWNERS: Record<string, string> = {
  ReadonlyArray: "Array",
  ReadonlyMap: "Map",
  ReadonlySet: "Set",
};

export interface LibraryMember {
  /** `Array.push`, `lucent:core.delay`. */
  readonly name: string;
  /** Undefined when the member's effects are not known. */
  readonly effect?: LibraryEffect;
}

/**
 * The library member a declaration is (a method, a construct or call
 * signature of a constructor, a global function), or undefined when it is
 * not the library's.
 */
export function libraryMember(decl: ts.Declaration): LibraryMember | undefined {
  const sf = decl.getSourceFile();
  const core = path.resolve(sf.fileName) === path.resolve(coreTypesPath());
  const builtin = core ? "lucent:core" : builtinSdkModuleOf(sf);

  if (!builtin && !isLibFile(sf)) return undefined;

  const owner = builtin && ownerName(decl.parent);
  const name = builtin
    ? `${builtin}.${owner ? `${owner}.` : ""}${ownName(decl)}`
    : libraryName(decl);
  const effect = LIBRARY[name] ?? (builtin ? MODULE_DEFAULTS[builtin] : undefined);

  return effect ? { name, effect } : { name };
}

function libraryName(decl: ts.Declaration): string {
  const own = ownName(decl);
  const owner = ownerName(decl.parent);

  return owner ? `${OWNERS[owner] ?? owner}.${own}` : own;
}

/** A member's name; `new` and `call` for construct and call signatures. */
function ownName(decl: ts.Declaration): string {
  if (ts.isConstructSignatureDeclaration(decl) || ts.isConstructorDeclaration(decl)) return "new";

  if (ts.isCallSignatureDeclaration(decl)) return "call";

  const name = (decl as ts.NamedDeclaration).name;

  if (name && ts.isComputedPropertyName(name) && name.expression.getText() === "Symbol.dispose")
    return "[Symbol.dispose]";

  return name && ts.isIdentifier(name) ? name.text : "";
}

/**
 * The interface declaring a member: its name, or for an inline type
 * (`declare var AbortController: { new (): … }`) the variable's.
 */
function ownerName(parent: ts.Node | undefined): string | undefined {
  if (!parent) return undefined;

  if (ts.isInterfaceDeclaration(parent) || ts.isClassDeclaration(parent)) return parent.name?.text;

  if (ts.isTypeLiteralNode(parent) && ts.isVariableDeclaration(parent.parent))
    return ts.isIdentifier(parent.parent.name) ? parent.parent.name.text : undefined;

  return undefined;
}
