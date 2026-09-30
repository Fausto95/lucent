(async () => {
  print(mod.scoped().join(", "));
  print(mod.early(true).join(", "));
  print(mod.early(false).join(", "));
  print(mod.throwing().join(", "));
  print(mod.loop().join(", "));
  print(mod.nullable(true).join(", "));
  print(mod.nullable(false).join(", "));
  print(mod.disposeThrows().join(", "));
  print(mod.suppressed().join(", "));
  print((await mod.inAsync()).join(", "));
  print(mod.explicit().join(", "));
})();
