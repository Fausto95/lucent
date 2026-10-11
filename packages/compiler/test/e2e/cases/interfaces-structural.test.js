print(mod.literals());
print(mod.identity());
print(mod.labeled());
print(mod.placed());
print(mod.json());
const p = mod.toJs();
print(p.x, p.y, JSON.stringify(p));
print(JSON.stringify(mod.placedToJs()));
