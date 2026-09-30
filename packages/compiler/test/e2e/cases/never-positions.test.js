for (const name of [
  "argument",
  "arguments_",
  "constructed",
  "defaults",
  "initialized",
  "assigned",
  "assignedField",
  "compound",
  "compoundShared",
  "field",
  "element",
  "tuple",
  "pushed",
  "mapped",
  "template",
  "operands",
  "unary",
  "compared",
  "condition",
  "negated",
  "leftOperand",
  "looped",
  "switched",
]) {
  print(name, mod[name](true), "|", mod[name](false));
}
print(mod.exhaustive("circle"), mod.exhaustive("square"));
print(mod.nothing());
