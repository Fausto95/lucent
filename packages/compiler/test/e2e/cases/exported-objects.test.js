const got = [];
const first = mod.pings.addListener("ping", (n) => got.push(n));
print(mod.pings === mod.pings, mod.settings.size, mod.limit);
print(mod.ping(1), got.join(","));
first.remove();

if (globalThis.__lucentReplaceHost) {
  globalThis.__lucentReplaceHost();
  const again = mod.pings.addListener("ping", (n) => got.push(n * 10));
  print(mod.pings === mod.pings, mod.settings.size, mod.limit);
  print(mod.ping(2), got.join(","));
  again.remove();
} else {
  // JavaScript has no host to replace: the same module, the same objects.
  const again = mod.pings.addListener("ping", (n) => got.push(n * 10));
  print(mod.pings === mod.pings, mod.settings.size, mod.limit);
  print(mod.ping(2), got.join(","));
  again.remove();
}
