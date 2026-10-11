print(mod.observed());
print(mod.fromLucent());

// JavaScript's listeners count too.
const first = mod.sensor.addListener("reading", () => {});
const second = mod.sensor.addListener("reading", () => {});
print(mod.observed());
first.remove();
print(mod.observed());
second.remove();
print(mod.observed());

print(mod.removed());
print(mod.late());
print(mod.reentrant());
print(mod.stopWatching());
