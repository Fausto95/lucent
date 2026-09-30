(async () => {
  for (const big of [true, false]) {
    print("declared", big, mod.describe(mod.declared(big)));
    print("returned", big, mod.describe(mod.returned(big)));
    print("assigned", big, mod.describe(mod.assigned(big)));
    print("passed", big, mod.passed(big));
    print("listed", big, mod.listed(big).map(mod.describe).join());
  }
  print("nested", [2, 1, 0].map((n) => mod.describe(mod.nested(n))).join());
  print("area", mod.area(true), mod.area(false));
  print("areaOf", mod.areaOf(true, 5));
  print("radiusOf", mod.radiusOf(true), mod.radiusOf(false));
  print("pick", await mod.pick(true), await mod.pick(false));
})();
