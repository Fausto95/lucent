print(mod.counted());
print(mod.kept());
print(mod.once());
print(mod.ticks());
print(mod.throws());
print(mod.checked());
try {
  mod.failed();
} catch (e) {
  print(e.name, e.message, e.code);
}
(async () => {
  print(mod.threaded());
  print(await mod.afterwards());
})();
