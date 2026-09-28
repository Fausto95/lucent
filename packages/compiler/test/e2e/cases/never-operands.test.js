print(mod.nullish("ada", 2), "|", mod.nullish(undefined, 2), "|", mod.nullish("ada", null));
print(mod.nullishObject(true), "|", mod.nullishObject(false));
print(mod.nullishMethod(true), "|", mod.nullishMethod(false));
print(mod.nullishArrow(true), "|", mod.nullishArrow(false));
print(mod.logical("a", false, 0), "|", mod.logical("", false, 0));
print(mod.logical("a", true, 0), "|", mod.logical("a", false, 3));
print(mod.conditional(1), "|", mod.conditional(2), "|", mod.conditional(3));
print(mod.assigns("given"), "|", mod.assigns());
