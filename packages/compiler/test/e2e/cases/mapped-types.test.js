print(JSON.stringify(mod.withDefaults({ x: 1, label: "a" })), JSON.stringify(mod.withDefaults({})));
print(mod.picked({ x: 2, label: "b" }), mod.omitted({ x: 3, y: 4 }));
print(mod.required({ x: 1, y: 2, label: "c" }), mod.frozen({ x: 5, y: 6, label: "d" }));
print(mod.total({ home: 1, away: 2 }), JSON.stringify(mod.scores(4)));
print(mod.inLucent());
print(
  mod.byState([
    { title: "a", done: true },
    { title: "b", done: false },
    { title: "c", done: true },
  ]),
  mod.byState([{ title: "x", done: false }]),
  mod.byState([]),
);
