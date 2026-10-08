// Lucent runtime — a CVPixelBuffer's bytes, read in place: `withPixelBytes`
// from lucent:ios (Objective-C++ with ARC, iOS only). Links CoreVideo.
#pragma once

#import <CoreVideo/CoreVideo.h>

#include "ios.h"

namespace lucent::objc {

/// Unlocks a pixel buffer locked for reading when it leaves scope, a throw included.
struct PixelLock {
  CVPixelBufferRef buffer;
  ~PixelLock() { CVPixelBufferUnlockBaseAddress(buffer, kCVPixelBufferLock_ReadOnly); }
};

/**
 * Calls `f(bytes, bytesPerRow, width, height)` with a pixel buffer's plane
 * locked for reading, and unlocks it after (a throw included): `bytes` is
 * the plane's bytes, copied once under the lock.
 */
template <class F>
auto withPixelBytes(const NativeRef& pixels, F&& f, Opt<double> plane = undefined) {
  id o = unwrap(pixels);
  if (!o || CFGetTypeID((__bridge CFTypeRef)o) != CVPixelBufferGetTypeID())
    throw Exception(makeError(String::fromLatin1("TypeError"), String::fromLatin1("withPixelBytes needs a CVPixelBuffer")));
  CVPixelBufferRef buffer = (__bridge CVPixelBufferRef)o;

  size_t planes = CVPixelBufferGetPlaneCount(buffer);
  double wanted = plane.has() ? plane.get() : 0;
  if (!(wanted >= 0) || wanted >= static_cast<double>(planes ? planes : 1) || wanted != static_cast<double>(static_cast<size_t>(wanted)))
    throwRangeError("withPixelBytes: no such plane");
  size_t p = static_cast<size_t>(wanted);

  if (CVPixelBufferLockBaseAddress(buffer, kCVPixelBufferLock_ReadOnly) != kCVReturnSuccess)
    throw Exception(makeError(String::fromLatin1("Error"), String::fromLatin1("withPixelBytes: the pixel buffer could not be locked")));
  PixelLock lock{buffer};

  uint8_t* base = static_cast<uint8_t*>(planes ? CVPixelBufferGetBaseAddressOfPlane(buffer, p) : CVPixelBufferGetBaseAddress(buffer));
  size_t stride = planes ? CVPixelBufferGetBytesPerRowOfPlane(buffer, p) : CVPixelBufferGetBytesPerRow(buffer);
  size_t width = planes ? CVPixelBufferGetWidthOfPlane(buffer, p) : CVPixelBufferGetWidth(buffer);
  size_t height = planes ? CVPixelBufferGetHeightOfPlane(buffer, p) : CVPixelBufferGetHeight(buffer);
  size_t size = stride * height;

  // One copy of the plane, made while it is locked: Bytes owns its storage (bytes.h), so a
  // view of the buffer's own memory would outlive the lock.
  Bytes bytes = Bytes::copy(base, size);
  return f(bytes, static_cast<double>(stride), static_cast<double>(width), static_cast<double>(height));
}

}  // namespace lucent::objc
