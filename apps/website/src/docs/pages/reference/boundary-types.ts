import type { Block } from "../../types";

export const blocks: Block[] = [
  {
    kind: "table",
    head: ["TypeScript", "C++", "Crosses as", "JavaScript must pass"],
    rows: [
      ["`number`", "`double`", "a copy", "a number"],
      ["`boolean`", "`bool`", "a copy", "a boolean"],
      ["`string`, string literal types", "`lucent::String`, UTF-16", "a copy", "a string; any string, for literal types"],
      ["`T | null`, `T | undefined`, `x?: T`", "`lucent::Opt<T>`", "the value, or its absence", "`null` or `undefined` for absent: both, whatever the type declares"],
      ["`T[]`", "`lucent::Array<T>`", "a copy", "an array; each element is checked"],
      ["`[A, B]`", "`std::tuple<A, B>`", "a copy", "an array"],
      ["object types, interfaces without methods", "a struct, by shape", "a copy", "an object with each declared field; extra fields are ignored"],
      ["`Record<string, V>`", "`lucent::Dict<V>`", "a copy", "an object; each value is checked"],
      ["`Map<K, V>`, `Set<T>`", "`lucent::Map`, `lucent::Set`", "a copy", "a `Map` or a `Set`"],
      ["`Uint8Array`", "`lucent::Bytes`", "a copy", "a `Uint8Array` or an `ArrayBuffer`"],
      ["`Date`", "`lucent::Date`", "a copy of its time", "an object with `getTime()`"],
      ["`RegExp`", "`lucent::RegExp`", "its source and flags", "a `RegExp`; `lastIndex` isn't kept"],
      ["enums", "`double` or `lucent::String`", "a copy", "a number or a string; membership isn't checked"],
      ["unions", "`std::variant`", "the member JavaScript's value matches", "a value of one member; object members need a string-literal discriminant (`LUCENT2005`)"],
      ["classes", "a reference-counted object", "**a reference**, with its identity", "an instance of that Lucent class"],
      ["interfaces a class `implements`", "the class's object", "**a reference**", "an instance of a Lucent class that implements it"],
      ["functions", "`lucent::Fn`", "**a callback**", "a function"],
      ["`Promise<T>`", "`lucent::Promise<T>`", "**a promise**", "a promise or any value, as `await` takes"],
      ["`AbortSignal`", "`lucent::AbortSignal`", "into Lucent only", "an `AbortSignal`"],
      ["`Error`, `TypeError`, `RangeError`", "`lucent::Error`", "its name, message and code", "any value"],
      ["`Iterable<T>` (parameters only)", "`lucent::Iter<T>`", "a snapshot, as `Array.from` takes", "an iterable"],
      ["`void`", "`void`", "`undefined`", ""],
    ],
  },
  { kind: "h2", text: "When a value doesn't match" },
  {
    kind: "p",
    text: "The call throws a `TypeError` before your code runs, even for an `async` export. The message names the function, the argument and the path to the bad value:",
  },
  {
    kind: "code",
    filename: "terminal",
    copy: false,
    code: `TypeError: hash: argument 'input' must be a string, got a number
TypeError: midpoint: argument 'a'.y must be a number, got undefined`,
  },
  { kind: "h2", text: "What can't cross" },
  {
    kind: "table",
    head: ["Value", "Code"],
    rows: [
      ["SDK objects, such as a `CLLocationManager`", "`LUCENT2006`"],
      ["iterators and generators, returned", "`LUCENT2006`"],
      ["an `AbortSignal` going out, and `AbortController` either way", "`LUCENT2006`"],
      ["generic functions, classes and values", "`LUCENT2007`"],
      ["unions whose members JavaScript can't tell apart", "`LUCENT2005`"],
    ],
  },
  { kind: "h2", text: "Class instances" },
  {
    kind: "list",
    items: [
      "The same native object is the same JS object each time, so `===` works. It lives while either side holds it.",
      "JavaScript can call `new` on an exported class. The constructor's arguments are checked like a function's.",
      "Public fields, getters, setters and methods are on the prototype. Each read of an array or object field returns a fresh copy.",
      "Static methods are on the constructor. Static fields aren't visible from JavaScript.",
      "`private`, `protected` and `#private` members are hidden.",
    ],
  },
  { kind: "h2", text: "Callbacks" },
  {
    kind: "list",
    items: [
      "Called during a synchronous call from JavaScript, a callback runs at once and may return any value that can cross.",
      "Called from async code, it is posted to the JS thread. It must return `void`, or a `Promise` that Lucent can `await`.",
      "A JavaScript error thrown in a callback becomes a Lucent error that `catch` can handle.",
      "The function is released when the last Lucent reference to it goes.",
    ],
  },
];
