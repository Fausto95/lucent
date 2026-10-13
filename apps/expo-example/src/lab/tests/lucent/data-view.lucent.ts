/** Every getter and setter, big-endian unless asked, over part of a buffer. */
export function orders(): string {
  const buffer = new ArrayBuffer(16);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer, 1, 12);

  view.setUint16(0, 0x0102);

  const big = `${bytes[1]},${bytes[2]}`;

  view.setUint16(0, 0x0102, true);

  const little = `${bytes[1]},${bytes[2]}`;

  view.setInt8(2, 200);
  view.setInt32(3, -2, true);
  view.setFloat32(7, 1.5);

  const whole = new DataView(buffer);

  whole.setFloat64(8, -2.5, true);
  whole.setBigInt64(0, -3n);

  return [
    big,
    little,
    view.getInt8(2),
    view.getUint8(2),
    view.getInt32(3, true),
    view.getUint32(3, true),
    view.getInt16(3),
    view.getFloat32(7),
    whole.getFloat64(8, true),
    whole.getBigInt64(0),
    whole.getBigUint64(0),
    view.byteOffset,
    view.byteLength,
    view.buffer === buffer,
  ].join(" ");
}

/** Reads and writes past the view's end, and views past the buffer's, are RangeErrors. */
export function bounds(): string {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer, 4);
  const attempts: (() => number)[] = [
    () => view.getUint32(1),
    () => {
      view.setFloat64(0, 1);
      return 0;
    },
    () => view.getUint8(4),
    () => new DataView(buffer, 9).byteLength,
    () => new DataView(buffer, 4, 5).byteLength,
    () => view.getUint32(0),
  ];

  return attempts
    .map((attempt) => {
      try {
        return String(attempt());
      } catch (e) {
        return (e as Error).name;
      }
    })
    .join(",");
}

/** A header parsed as a file format's reader would: a magic, a length and samples. */
export function header(data: Uint8Array): string {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const magic = view.getUint32(0);
  const count = view.getUint16(4, true);
  const samples: number[] = [];

  for (let i = 0; i < count; i++) samples.push(view.getInt16(6 + i * 2, true));

  return `${magic.toString(16)} ${count} ${samples.join(",")}`;
}

export function copied(view: DataView): DataView {
  view.setUint8(0, 42);
  return view;
}
