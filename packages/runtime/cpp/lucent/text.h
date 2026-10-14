// Lucent runtime — TextEncoder and TextDecoder, by WHATWG's Encoding
// standard, for UTF-8: the only encoding a TextEncoder has, and the only
// one Lucent's TextDecoder decodes. And atob and btoa, by HTML's forgiving
// base64.
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

#include "bytes.h"
#include "core.h"
#include "jsstring.h"

namespace lucent {

/// WHATWG's UTF-8 decoder: what it holds of a sequence between the chunks of a stream.
class Utf8Decoder {
 public:
  /// Decodes `n` bytes, appending UTF-16 to `out`. At `end`, an unfinished
  /// sequence is an error. An error appends U+FFFD, or when `fatal` returns
  /// false at once, the decoder ready for new input.
  bool decode(const uint8_t* bytes, size_t n, bool end, bool fatal, std::u16string& out);
  /// Whether it holds part of a sequence.
  bool pending() const { return needed_ != 0; }
  void reset() { *this = Utf8Decoder(); }

 private:
  uint32_t codePoint_ = 0;
  uint8_t needed_ = 0;
  uint8_t seen_ = 0;
  uint8_t lower_ = 0x80;
  uint8_t upper_ = 0xBF;
};

/// `new TextDecoder().decode(bytes)` with `ignoreBOM`: lucent:core's utf8Decode.
String utf8DecodeBytes(const uint8_t* bytes, size_t n);

struct TextEncoderObject : Object {
  String encoding() const { return String::fromLatin1("utf-8"); }
  Bytes encode() const { return Bytes(); }
  Bytes encode(const String& input) const { return utf8Encode(input); }
  /// `encode(undefined)` encodes "".
  Bytes encode(const Opt<String>& input) const { return input.has() ? utf8Encode(input.get()) : Bytes(); }
  /// `encodeInto(source, destination)`: the whole characters of `source`
  /// that fit, written from the start of `destination`. `read` counts
  /// UTF-16 code units, `written` bytes.
  void encodeInto(const String& source, Bytes& destination, double& read, double& written) const;
};
using TextEncoder = Ref<TextEncoderObject>;

struct TextDecoderObject : Object {
  const bool fatal;
  const bool ignoreBOM;

  TextDecoderObject(bool fatal, bool ignoreBOM) : fatal(fatal), ignoreBOM(ignoreBOM) {}

  String encoding() const { return String::fromLatin1("utf-8"); }

  /// `decode(input, { stream })`: with `stream`, a sequence the input ends
  /// inside of waits for the next call. A fatal decoder throws a TypeError
  /// where the input is not UTF-8.
  String decode(const uint8_t* bytes, size_t n, bool stream);
  /// `decode()`, of no input: what a stream held ends.
  String decode(bool stream) { return decode(nullptr, 0, stream); }
  template <class K>
  String decode(const TypedArray<K>& view, bool stream) {
    return decode(view.data(), static_cast<size_t>(view.byteLength()), stream);
  }
  String decode(const DataView& view, bool stream) { return decode(view.storage()->data() + view.offset(), view.size(), stream); }
  String decode(const ArrayBuffer& buffer, bool stream) { return decode(buffer.data(), buffer.size(), stream); }
  /// Undefined is no input.
  template <class V>
  String decode(const Opt<V>& input, bool stream) {
    return input.has() ? decode(input.get(), stream) : decode(stream);
  }

 private:
  Utf8Decoder decoder_;
  bool bomSeen_ = false;
  bool doNotFlush_ = false;
};
using TextDecoder = Ref<TextDecoderObject>;

/// `new TextDecoder(label, { fatal, ignoreBOM })`: a RangeError for a
/// label that does not name UTF-8, which is the only encoding Lucent decodes.
TextDecoder makeTextDecoder(const Opt<String>& label, bool fatal, bool ignoreBOM);

/// `atob(data)`: forgiving base64 (ASCII whitespace ignored, the padding
/// optional) to a string of bytes, one character each. An
/// InvalidCharacterError, with Node's messages, where data isn't base64.
String atob(const String& data);
/// `btoa(data)`: the base64 of a string of bytes. An InvalidCharacterError
/// where a character is past U+00FF.
String btoa(const String& data);

inline String toJsString(const TextEncoder&) { return String::fromLatin1("[object TextEncoder]"); }
inline String toJsString(const TextDecoder&) { return String::fromLatin1("[object TextDecoder]"); }

}  // namespace lucent
