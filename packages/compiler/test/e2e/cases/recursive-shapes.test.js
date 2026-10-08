const t = {
  value: 1,
  children: [
    { value: 2, children: [] },
    { value: 3, children: [{ value: 4, children: [] }] },
  ],
};
print(mod.treeSize(t));
print(JSON.stringify(mod.grow(t)));
print(mod.lenB({ v: 1, next: { v: 2, next: { v: 3 } } }));
print(mod.evens({ n: 1, other: { n: "a", other: { n: 2 } } }));
print(mod.selfs({ n: 1, other: { n: 2, other: { n: 3 } } }));
print(
  mod.sum({
    tag: "list",
    items: [
      { tag: "num", n: 2 },
      { tag: "list", items: [{ tag: "num", n: 5 }] },
    ],
  }),
);
print(mod.names({ name: "root", kids: new Map([["a", { name: "a", kids: null }]]) }));
