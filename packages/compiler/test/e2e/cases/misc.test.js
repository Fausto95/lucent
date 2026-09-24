print(mod.colorName("red"), mod.colorName("green"), mod.level(0), mod.level(10));
print(mod.VERSION, JSON.stringify(mod.LIMITS));
print(mod.checksum(new Uint8Array([200, 100, 7])));
const b = mod.bytesOps(4);
print(b instanceof Uint8Array, Array.from(b).join(","));
print(mod.roundTrip("héllo 🌍"));
print(
  mod.optional({ name: "a" }),
  mod.optional({ name: "b", retries: 0, nested: {} }),
  mod.optional({ name: "c", nested: { deep: "xyz" } }),
);
print(mod.jsonOut());
print(mod.counterKeys("banana"));
