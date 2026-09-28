(async () => {
  print(await mod.sample());

  // From JavaScript, a buffer is an opaque handle: its borrows lend copies.
  const buffer = mod.make(new Uint8Array([100, 200, 3]));
  print(buffer.byteLength, mod.echo(buffer) === buffer, ArrayBuffer.isView(buffer));
  mod.double(buffer);
  print(Array.from(buffer.toUint8Array()).join(","), mod.total(buffer));
  buffer.withWrite((bytes) => {
    bytes[0] = 1;
  });
  print(buffer.withRead((bytes) => bytes[0] + bytes.length));
  try {
    buffer.withRead(() => buffer.withWrite(() => {}));
  } catch (e) {
    print(e.name, e.message);
  }
  const moved = buffer.transfer();
  print(buffer.byteLength, moved.byteLength, mod.total(moved));
  try {
    mod.total(buffer);
  } catch (e) {
    print(e.name, e.message);
  }
  moved.close();
  moved.close();
  print(moved.byteLength);

  print(mod.spans());
  print(mod.snapshots());
  print(mod.texts());
  print(mod.sizes());
  print(mod.conflicts());
  print(mod.aliases());
  print(await mod.handoff());
  print(await mod.borrowedHandoff());
  print(await mod.inputs());
  for (const size of [1024, 65536, 1048576]) print(await mod.copies(size));
  print(await mod.stream(16, 65536));
})();
