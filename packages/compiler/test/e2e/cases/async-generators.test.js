// Sequential: each awaits its own result.
(async () => {
  print(await mod.counted());
  print(await mod.leftEarly());
  print(await mod.manual());
  print(await mod.thrown());
  print(await mod.returnedEarly());
  print(await mod.queued());
  print(await mod.lazy());
  print(await mod.fromMethodAndClosure());
  print(await mod.leftByReturnAndThrow());
  print(await mod.caughtInside());
})();
