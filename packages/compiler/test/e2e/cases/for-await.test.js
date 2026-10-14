(async () => {
  print(await mod.overChannel());
  print(await mod.leaveEarly());
  print(await mod.overPromises());
  print(await mod.withDestructuring());
  print(await mod.throwsOut());
})();
