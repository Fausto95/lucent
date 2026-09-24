(async () => {
  print(await mod.double(21));
  print(JSON.stringify(await mod.sequence([1, 2, 3])));
  print(JSON.stringify(await mod.parallel([4, 5, 6])));
  try {
    await mod.failing("bad");
  } catch (e) {
    print("rejected:", e.message);
  }
  print(await mod.recovers());
  const steps = [];
  print(await mod.withProgress(3, (i) => steps.push(i)), steps.join(","));
  print(await mod.askJs(async (q) => (q === "first" ? 1 : 41)));
  try {
    await mod.askJs(async () => {
      throw new Error("js said no");
    });
  } catch (e) {
    print("js rejection:", e.message);
  }
  const Loader = lucentClass(mod.Loader);
  const l = new Loader();
  print(await l.load("x"), await l.load("x"), await l.load("y"), l.loads);
  print(await mod.orderCheck());
  const logs = [];
  const r = await mod.voidAsync((s) => logs.push(s));
  print(r, logs.join(","));
  print(await mod.noAwait(1));
  print(await mod.allRejectsEarly());
  print(await mod.tupleRejectsEarly());
  print(await mod.allTicks());
  print(await mod.promised(21));
  try {
    await mod.promiseRejects();
  } catch (e) {
    print(e.name, e.message);
  }
  try {
    await mod.promiseThrows();
  } catch (e) {
    print(e.name, e.message);
  }
  print(await mod.promiseSettlesOnce(), await mod.promiseOfNothing());
  // The runtime gets a new Lucent host while this code holds the old one's
  // exports (the native host only; a no-op as JavaScript): they keep working.
  const { double, withProgress, promised, Loader: OldLoader } = mod;
  if (globalThis.__lucentReplaceHost) globalThis.__lucentReplaceHost();
  const after = [];
  print(
    await double(4),
    await promised(5),
    await withProgress(2, (i) => after.push(i)),
    after.join(","),
  );
  const old = new OldLoader();
  print(await old.load("z"), old.loads);
})();
