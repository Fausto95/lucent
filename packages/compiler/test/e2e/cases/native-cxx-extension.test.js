const Tally = lucentClass(mod.Tally);
const before = mod.live();

const t = new Tally("t");
print(t.add(1.5), t.add(2), String(t.total()), t.history().join(","));
print(mod.live() - before);

print(mod.version());
print(mod.made());
print(mod.strings());
print(mod.rounding());
print(mod.objects());
print(mod.errors());
print(mod.callbacks());
print(mod.callbackThrows());
print(mod.stopping());

t.close();
try {
  t.add(1);
} catch (e) {
  print(e.name, e.message);
}
print(mod.live() - before);
