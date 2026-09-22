import { type Frame, width, height, rowStride, pixelStride, sample } from "@camera/frames";

/** Process the Y plane while the SDK callback owns its frame. */
@NativeOnly
export function luminance(frame: Frame): number {
  const columns = width(frame);
  const rows = height(frame);
  const rowStep = rowStride(frame);
  const pixelStep = pixelStride(frame);
  if (columns <= 0 || rows <= 0 || rowStep <= 0 || pixelStep <= 0) {
    throw new LucentError("INVALID_FRAME");
  }
  let total = 0;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      total += sample(frame, y * rowStep + x * pixelStep);
    }
  }
  return total / (columns * rows);
}
