(async () => {
  print(await mod.policies());
  print(mod.capacities());
  print(await mod.waits());
  print(await mod.closing());
  print(await mod.copies());
  print(await mod.buffers());
  print(await mod.fromTask());
  print(await mod.classes());
  for (const v of [1, 2, 3]) mod.record(v);
  print(await mod.recorded());
})();
