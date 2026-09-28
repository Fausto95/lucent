(async () => {
  print(await mod.edges(new Uint8Array([0, 0, 100, 100, 10, 12, 200])));
  print(await mod.edges(new Uint8Array([5, 5, 5])));
  print(await mod.root(16));
  print(await mod.root(-1));
  print(await mod.cancelled("before"));
  print(await mod.cancelled("after"));
  print(await mod.snapshot());
  print(await mod.graph());
  print(await mod.results());
  print(await mod.objects());
  print(await mod.bytes());
  print(await mod.many());
  print(await mod.start(1000));
  print(await mod.constants());
  print(await mod.conversions());
  const aborted = new AbortController();
  aborted.abort();
  try {
    await mod.edges(new Uint8Array([1, 200]), aborted.signal);
  } catch (e) {
    print(e.name);
  }
})();
