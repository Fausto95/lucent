(async () => {
  print(await mod.awaitValues());
  print(await mod.readBeforeWaiting());
  print(await mod.returnOrder());
  print(await mod.returnRejected());
  print(await mod.returnTypes());
})();
