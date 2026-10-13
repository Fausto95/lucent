print(mod.samples());
print(mod.kinds());
print(mod.refusals());

// From JavaScript, a buffer's typed borrows lend copies of its kind.
const buffer = mod.made();
print(buffer.withReadAs(Int32Array, (w) => `${w instanceof Int32Array} ${w.join(",")}`));
buffer.withWriteAs(Int32Array, (w) => {
  w[1] = 9;
});
print(mod.sum32(buffer));
try {
  buffer.withReadAs(Float64Array, (f) => f.length);
  print("read");
} catch (e) {
  print(e.name);
}
print(mod.made().withReadAs(Float64Array, (f) => f.length));
