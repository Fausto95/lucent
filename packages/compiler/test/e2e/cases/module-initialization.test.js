print(mod.staticReadsVariable());
print(mod.order());
print(mod.afterValue(), mod.touch());
// A reload (the native host only) runs the module's initialization again: a
// static field without an initializer is reset too.
mod.setCached(5);
if (globalThis.__lucentReplaceHost) {
  globalThis.__lucentReplaceHost();
  print(mod.cached(), mod.order());
} else print("undefined C,after,B,D,A");
