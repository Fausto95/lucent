const outcome = (f) => {
  try {
    return String(f());
  } catch (e) {
    return `${e.name}: ${e.message}`;
  }
};
// The boundary check exists natively only: as plain JavaScript, the lines
// print what the native host does.
const native = globalThis.__lucentHost !== undefined;
const boundary = (f, message) => print(native ? outcome(f) : `TypeError: ${message}`);

boundary(() => mod.label(null), "label: argument 'name' must be a string or undefined, got null");
boundary(() => mod.opt(null), "opt: argument 'name' must be a string or undefined, got null");
boundary(
  () => mod.orNull(undefined),
  "orNull: argument 'name' must be a string or null, got undefined",
);
boundary(
  () => mod.field({ note: null }),
  "field: argument 'r'.note must be a string or undefined, got null",
);
print(
  outcome(() => mod.label(undefined)),
  outcome(() => mod.label("ab")),
);
print(
  outcome(() => mod.opt()),
  outcome(() => mod.orNull(null)),
);
print(
  outcome(() => mod.both(null)),
  outcome(() => mod.both(undefined)),
  outcome(() => mod.both("x")),
);
print(
  outcome(() => mod.field({})),
  outcome(() => mod.field({ note: "n" })),
);
