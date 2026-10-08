const outcome = async (f) => {
  try {
    return String(await f());
  } catch (e) {
    return `${e.name}: ${e.message}`;
  }
};
// The boundary checks exist natively only: as plain JavaScript, the lines
// print what the native host does.
const native = globalThis.__lucentHost !== undefined;
const boundary = async (f, message) => print(native ? await outcome(f) : `TypeError: ${message}`);

(async () => {
  print(
    mod.total(1, 2, 3),
    mod.sizes({ a: [1], "b c": [2, 3] }),
    mod.mapped([1, 2], (x) => x * 2),
  );
  await boundary(() => mod.total(1, 2, "3"), "total: argument 3 must be a number, got a string");
  await boundary(
    () => mod.sizes({ ok: [1], "é k": [1, "x"] }),
    `sizes: argument 'r'["é k"][1] must be a number, got a string`,
  );
  await boundary(
    () => mod.mapped([1], () => "two"),
    "mapped (callback argument 'f'): return value must be a number, got a string",
  );
  await boundary(
    () => mod.nested({ inc: () => null }),
    `nested (callback argument 'r'["inc"]): return value must be a number, got null`,
  );
  await boundary(
    () => mod.awaited(Promise.resolve("x")),
    "awaited argument 'p': resolved value must be a number, got a string",
  );
  await boundary(
    () => mod.asked(async () => 7),
    "asked (callback argument 'f') return value: resolved value must be a string, got a number",
  );
  print(await mod.awaited(Promise.resolve(1)), await mod.asked(async (q) => q + q));
})();
