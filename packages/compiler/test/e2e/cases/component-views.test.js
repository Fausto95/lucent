(async () => {
  // What a component's ref carries: its view's tag.
  const a = { __lucentView: 11 };
  const b = { __lucentView: 12 };
  print(mod.keep(a));
  print(mod.keep(a));
  print(mod.isKept(b), mod.isKept(a));
  print(await mod.later(a));
  print(mod.both([a, b, a]));
})();
