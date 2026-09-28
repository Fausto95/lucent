const Filter = lucentClass(mod.Filter);
const before = mod.live();

const f = new Filter(1.5);
print(Array.from(f.apply(new Uint8Array([0, 10, 100, 200]))).join(","));
print(String(f.processed()), mod.live() - before);

try {
  print(new Filter(9).processed());
} catch (e) {
  print(e.name, e.message, e.code);
}

print(mod.shortOutput());
print(mod.labelBytes("héllo"));
print(mod.scoped());
print(mod.closeTwice());

f.close();
try {
  f.apply(new Uint8Array([1]));
} catch (e) {
  print(e.name, e.message);
}
print(mod.live() - before);
