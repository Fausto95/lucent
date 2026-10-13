(async () => {
  print(await mod.order());
  print(await mod.ticks());
  print(await mod.clears());
  print(await mod.awaited());
  print(await mod.noDelay());
})();
