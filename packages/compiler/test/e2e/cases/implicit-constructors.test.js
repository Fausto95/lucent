print(mod.parseError());
print(mod.caught());
print(mod.withoutMessage());
print(mod.named());
print(mod.twoLevels());
print(mod.derived());
print(mod.subCoded());
try {
  mod.thrown();
} catch (e) {
  print(e.name, e.message);
}
// Built from JavaScript, read back in Lucent.
const PE = lucentClass(mod.ParseError);
print(mod.messageOf(new PE("from js")));
