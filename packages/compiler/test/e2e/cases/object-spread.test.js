const full = { a: 1, b: 2, c: 3, d: "q" };
const partial = { a: 1, c: 3, d: "q" };

print("maybeFirst", mod.maybeFirst(full), mod.maybeFirst(partial), mod.maybeFirst(undefined));
print("maybeLast", mod.maybeLast(full), mod.maybeLast(partial), mod.maybeLast(undefined));
print("maybeReturned", mod.maybeReturned(undefined).d, mod.maybeReturned(full).a);
print("maybeOnce", mod.maybeOnce(full), mod.maybeOnce(undefined));
print(
  "merged",
  mod.merged({}),
  mod.merged({ size: 2 }),
  mod.merged({ label: "big", color: "blue" }),
);
