(async () => {
  print(mod.hash("hello"), mod.hash("hello", 7), mod.hash("🌍"));
  print(JSON.stringify(await mod.hashMany(["a", "b", "c"])));
  print(mod.clamp(15, 0, 10), mod.clamp(-1, 0, 10), mod.clamp(0.5, 0, 1));
  print(mod.describe(-3), mod.describe(0), mod.describe(2.5));
})();
