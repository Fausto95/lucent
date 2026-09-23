// Generated from packages/compiler/test/e2e/cases/interfaces.test.js. Do not edit.
// @ts-nocheck
export default function run(mod, print, lucentClass, mods) {
  (async () => {
    const Circle = lucentClass(mod.Circle);
    const Rect = lucentClass(mod.Rect);
    print(mod.totalArea([new Circle(1), new Rect(2, 3)]));
    print(mod.describeAll());
    const big = mod.largest([new Rect(1, 1), new Circle(2), new Rect(3, 3)]);
    print(big instanceof Rect, big.kind, big.area());
    print(mod.largest([]));
    const c = new Circle(1);
    print(mod.same(c, c), mod.same(c, new Circle(1)));
    print(mod.rename(c, "z"), c.name);
    const d = new Circle(3);
    d.name = "d";
    print(mod.circleNames([c, new Rect(1, 2), d]));
    print(mod.counters());
    print(await mod.loadVia("k"));
  })();
  print(mod.feeds());
  print(mod.tagged());
  const t = mod.exportTagged();
  print(t.label, t.tag());

}
