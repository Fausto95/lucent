print(mod.maps());
print(mod.sets());
print(mod.values());
print(mod.interfaceKeys());
print(mod.objectKeys());
print(mod.cached());

const Node = lucentClass(mod.Node);
const a = new Node("a");
const b = new Node("b");
mod.register(a, "first");
print(mod.labelOf(a), mod.labelOf(b));
