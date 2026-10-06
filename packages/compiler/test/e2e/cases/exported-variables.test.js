const count = mod.count;
mod.bump();
print(mod.count - count);
const size = mod.config.size;
mod.grow();
print(mod.config.size - size);
print(mod.limit);
