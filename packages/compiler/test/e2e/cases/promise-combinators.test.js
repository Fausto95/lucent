(async () => {
  print(await mod.race());
  print(await mod.any());
  print(await mod.allSettled());
})();
