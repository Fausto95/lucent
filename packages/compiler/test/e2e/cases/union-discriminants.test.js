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

boundary(
  () => mod.shape({ kind: "triangle", r: 1 }),
  `shape: argument 's'.kind must be "circle" or "square", got "triangle"`,
);
boundary(
  () => mod.shape({ r: 1 }),
  `shape: argument 's'.kind must be "circle" or "square", got undefined`,
);
print(mod.shape({ kind: "circle", r: 2 }), mod.shape({ kind: "square", s: 3 }));
