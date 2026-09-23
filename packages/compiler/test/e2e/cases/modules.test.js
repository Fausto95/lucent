const main = mods.main;
print(JSON.stringify(main.sum([{ x: 1, y: 2 }, { x: 3, y: 4 }])));
print(main.far([{ x: 1, y: 1 }, { x: -3, y: 2 }, { x: 0, y: 0 }]), main.far([]));
print(main.vectorsMade() > 0);
