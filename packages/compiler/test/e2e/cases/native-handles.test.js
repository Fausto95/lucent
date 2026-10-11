print(mod.borrows());
print(mod.refused());
print(mod.shared());
const buffer = mod.pixels(16);
const handle = mod.handleOf(buffer);
print(typeof handle.pointer, handle.pointer !== 0n, mod.describe(handle));
print(handle.release(), handle.release(), handle.pointer, handle.released, mod.describe(handle));
buffer.close();
