print(mod.helperAfter(), mod.closureAfter(), mod.recursive());
print(mod.hoistedCall());
print(mod.closureBefore());
print(mod.writtenBefore());
print(mod.inLoops(), mod.declaredUndefined());
print(mod.moduleStart());
print(mod.sum());
// A reload (the native host only) starts the module again, in its dead zones.
if (globalThis.__lucentReplaceHost) globalThis.__lucentReplaceHost();
print(mod.moduleStart());
