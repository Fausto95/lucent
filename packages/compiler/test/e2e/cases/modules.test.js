const main = mods.main;
print(
  JSON.stringify(
    main.sum([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]),
  ),
);
print(
  main.far([
    { x: 1, y: 1 },
    { x: -3, y: 2 },
    { x: 0, y: 0 },
  ]),
  main.far([]),
);
print(main.vectorsMade() > 0);
print(main.throughNamespace());
const Vec = lucentClass(mods.shapes.Vec);
const g = main.grown(new Vec(1, 2));
print(g instanceof Vec, g.x, g.y, main.grown(g).plus(new Vec(0, 1)).y);
