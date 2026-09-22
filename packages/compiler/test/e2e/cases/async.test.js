(async () => {
  print(await mod.double(21));
  print(JSON.stringify(await mod.sequence([1, 2, 3])));
  print(JSON.stringify(await mod.parallel([4, 5, 6])));
  try { await mod.failing("bad"); } catch (e) { print("rejected:", e.message); }
  print(await mod.recovers());
  const steps = [];
  print(await mod.withProgress(3, (i) => steps.push(i)), steps.join(","));
  print(await mod.askJs(async (q) => (q === "first" ? 1 : 41)));
  try { await mod.askJs(async () => { throw new Error("js said no"); }); } catch (e) { print("js rejection:", e.message); }
  const Loader = lucentClass(mod.Loader);
  const l = new Loader();
  print(await l.load("x"), await l.load("x"), await l.load("y"), l.loads);
  print(await mod.orderCheck());
  const logs = [];
  const r = await mod.voidAsync((s) => logs.push(s));
  print(r, logs.join(","));
  print(await mod.noAwait(1));
})();
