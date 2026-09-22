print(JSON.stringify(mod.makeAdders()));
print(mod.counter(), mod.compose(5), mod.recurse(10), mod.memo(50));
print(mod.apply("add", 2, 3), mod.apply("mul", 2, 3), mod.apply("nope", 1, 1));
print(mod.accumulate(1), mod.accumulate(2), mod.accumulate(3));
const greet = mod.makeGreeter("Hello");
print(greet("Ada"), greet("Bo"));
print(mod.callTwice((x) => x * 3, 2));
print(JSON.stringify(mod.sortBy([{ name: "b", age: 2 }, { name: "a", age: 2 }, { name: "c", age: 1 }])));
