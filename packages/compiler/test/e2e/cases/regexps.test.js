print(mod.basics());
print(mod.named());
print(mod.globalExec());
print(mod.stringMethods("the quick brown fox"));
print(mod.matchAllGroups());
print(mod.flags());
print(mod.sticky());
print(
  mod.dynamic("a+", "g", "caaab aa"),
  mod.dynamic("(", "", "x"),
  mod.dynamic("x", "gg", "x"),
  mod.dynamic("\\d", "", "abc"),
);
print(mod.callbackReplace("10px 3 7px"));
