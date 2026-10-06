const Registry = lucentClass(mod.Registry);
const Scoped = lucentClass(mod.Scoped);

// A run starts from the state it sets: the example apps run a case again.
Registry.count = 0;
Registry.names = [];
print(Registry.count, Registry.label, Registry.limit, Registry.names.length);
print(Registry.add("a"), Registry.add("b"), Registry.count, Registry.names.join("+"));
print(Registry.summary(), mod.read(), new Registry().seen);

// Writes from JavaScript reach Lucent.
Registry.label = "renamed";
Registry.count = 10;
print(mod.read(), Registry.summary(), Registry.label);
Registry.label = "registry";

// A subclass sees its own statics and inherits its base's.
print(Scoped.scope, Scoped.where(), Scoped.label, Scoped.count, typeof Scoped.add);
print(Scoped.add("c"), Registry.count, Scoped.summary());
