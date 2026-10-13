(async () => {
  print(await mod.interleaved());
  print(await mod.rejections());
  print(await mod.finallyOrder());
})();
