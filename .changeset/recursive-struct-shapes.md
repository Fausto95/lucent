---
"@lucent-lang/lucent": patch
---

Share one native struct between object types with the same recursive shape (`interface TreeNode { children: TreeNode[] }` and `type Tree = { children: Tree[] }`), instead of refusing to pass one as the other with `LUCENT2003`, and keep mutually recursive types from taking another type's layout.
