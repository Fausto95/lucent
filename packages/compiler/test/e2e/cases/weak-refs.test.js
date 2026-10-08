// While its target is held, a WeakRef derefs to it. When the last strong
// reference goes, native code frees the target at once, and JavaScript
// when its collector runs: docs/semantics.md.
print(mod.delegates());
print(mod.trees());
print(mod.identities());

const root = new mod.TreeNode("r");
const child = root.add(new mod.TreeNode("c"));
print(child.path(), child.parent === root, root.parent);
