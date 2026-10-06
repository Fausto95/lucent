(async () => {
  print(await mod.serialized());
  print(await mod.cached());
  print(mod.stringified());
  const w = mod.makeWriter();
  await w.write("js", 1);
  await w.pending;
  print(w.log.join(","), w.pending instanceof Promise);
})();
