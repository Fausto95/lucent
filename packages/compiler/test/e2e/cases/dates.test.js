print(mod.utc());
print(mod.parse());
print(mod.local());
print(mod.setters());
print(mod.invalid());
print(mod.compare());
print(mod.now());
const shifted = mod.shift(new Date(Date.UTC(2024, 1, 28)), 2);
print(shifted instanceof Date, shifted.toISOString(), mod.describe(new Date(0)));
try { mod.describe("2024"); } catch (e) { print("not a date:", e.name); }
