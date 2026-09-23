print(mod.divide(6, 3));
try { mod.divide(1, 0); } catch (e) { print(e instanceof Error, e.code, e.message); }
try { mod.validate(-5); } catch (e) { print(e.name, e.message); }
print(mod.validate(5), mod.safeDivide(1, 0), mod.safeDivide(1, 4));
print(mod.rethrow());
try { mod.failDeep(); } catch (e) { print("lucent site:", /failDeep \(.*errors\.lucent\.ts:\d+/.test(e.stack), e.stack.split("\n")[0]); }
function jsThrower() { throw new Error("from js"); }
try { mod.passThrough(jsThrower); } catch (e) { print("js stack kept:", e.stack.includes("jsThrower")); }
