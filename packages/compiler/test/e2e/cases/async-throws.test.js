(async () => {
  print(await mod.functions());
  print(await mod.arrows());

  let pending;

  try {
    pending = mod.exported();
    print("exported returned a promise");
  } catch (e) {
    print("exported threw", e.message);
  }

  try {
    await pending;
  } catch (e) {
    print("exported rejected", e.message);
  }
})();
