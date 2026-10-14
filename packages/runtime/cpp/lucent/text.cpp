#include "text.h"

#include <array>
#include <string_view>

#include "jserror.h"

namespace lucent {

namespace {

void appendCodePoint(std::u16string& out, uint32_t cp) {
  if (cp < 0x10000) {
    out.push_back(static_cast<char16_t>(cp));
    return;
  }
  cp -= 0x10000;
  out.push_back(static_cast<char16_t>(0xD800 + (cp >> 10)));
  out.push_back(static_cast<char16_t>(0xDC00 + (cp & 0x3FF)));
}

bool isAscii(const uint8_t* bytes, size_t n) {
  for (size_t i = 0; i < n; i++)
    if (bytes[i] >= 0x80) return false;
  return true;
}

/// The labels of UTF-8, as the Encoding standard lists them.
constexpr std::array<std::string_view, 6> kUtf8Labels = {
    "unicode-1-1-utf-8", "unicode11utf8", "unicode20utf8", "utf-8", "utf8", "x-unicode20utf8",
};

}  // namespace

bool Utf8Decoder::decode(const uint8_t* bytes, size_t n, bool end, bool fatal, std::u16string& out) {
  // The Encoding standard's UTF-8 decoder: an error is one U+FFFD for the
  // longest start of a sequence that could have been valid, and the byte
  // that ended it is read again.
  size_t i = 0;
  while (i < n) {
    const uint8_t b = bytes[i];
    if (needed_ == 0) {
      i++;
      if (b < 0x80) {
        out.push_back(b);
      } else if (b >= 0xC2 && b <= 0xDF) {
        needed_ = 1;
        codePoint_ = b & 0x1F;
      } else if (b >= 0xE0 && b <= 0xEF) {
        if (b == 0xE0) lower_ = 0xA0;
        if (b == 0xED) upper_ = 0x9F;
        needed_ = 2;
        codePoint_ = b & 0x0F;
      } else if (b >= 0xF0 && b <= 0xF4) {
        if (b == 0xF0) lower_ = 0x90;
        if (b == 0xF4) upper_ = 0x8F;
        needed_ = 3;
        codePoint_ = b & 0x07;
      } else {
        if (fatal) return false;
        out.push_back(0xFFFD);
      }
      continue;
    }
    if (b < lower_ || b > upper_) {
      // Not read: the next turn reads it as a sequence's start.
      reset();
      if (fatal) return false;
      out.push_back(0xFFFD);
      continue;
    }
    i++;
    lower_ = 0x80;
    upper_ = 0xBF;
    codePoint_ = (codePoint_ << 6) | (b & 0x3F);
    if (++seen_ != needed_) continue;
    appendCodePoint(out, codePoint_);
    reset();
  }
  if (end && needed_ != 0) {
    reset();
    if (fatal) return false;
    out.push_back(0xFFFD);
  }
  return true;
}

String utf8DecodeBytes(const uint8_t* bytes, size_t n) {
  if (isAscii(bytes, n)) return String::fromLatin1(std::string_view(reinterpret_cast<const char*>(bytes), n));
  std::u16string out;
  out.reserve(n);
  Utf8Decoder().decode(bytes, n, true, false, out);
  return String::fromUtf16(out);
}

void TextEncoderObject::encodeInto(const String& source, Bytes& destination, double& read, double& written) const {
  uint8_t* to = destination.data();
  const size_t room = destination.size();
  size_t units = 0;
  size_t bytes = 0;
  const size_t length = source.length();

  while (units < length) {
    uint32_t cp = source.unit(units);
    size_t taken = 1;
    if (cp >= 0xD800 && cp <= 0xDBFF && units + 1 < length) {
      const char16_t low = source.unit(units + 1);
      if (low >= 0xDC00 && low <= 0xDFFF) {
        cp = 0x10000 + ((cp - 0xD800) << 10) + (low - 0xDC00);
        taken = 2;
      }
    }
    // A lone surrogate is U+FFFD, as encode() writes it.
    if (cp >= 0xD800 && cp <= 0xDFFF) cp = 0xFFFD;
    const size_t size = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (bytes + size > room) break;
    uint8_t* at = to + bytes;
    switch (size) {
      case 1:
        at[0] = static_cast<uint8_t>(cp);
        break;
      case 2:
        at[0] = static_cast<uint8_t>(0xC0 | (cp >> 6));
        at[1] = static_cast<uint8_t>(0x80 | (cp & 0x3F));
        break;
      case 3:
        at[0] = static_cast<uint8_t>(0xE0 | (cp >> 12));
        at[1] = static_cast<uint8_t>(0x80 | ((cp >> 6) & 0x3F));
        at[2] = static_cast<uint8_t>(0x80 | (cp & 0x3F));
        break;
      default:
        at[0] = static_cast<uint8_t>(0xF0 | (cp >> 18));
        at[1] = static_cast<uint8_t>(0x80 | ((cp >> 12) & 0x3F));
        at[2] = static_cast<uint8_t>(0x80 | ((cp >> 6) & 0x3F));
        at[3] = static_cast<uint8_t>(0x80 | (cp & 0x3F));
        break;
    }
    bytes += size;
    units += taken;
  }
  read = static_cast<double>(units);
  written = static_cast<double>(bytes);
}

String TextDecoderObject::decode(const uint8_t* bytes, size_t n, bool stream) {
  if (!doNotFlush_) {
    decoder_.reset();
    bomSeen_ = false;
  }
  doNotFlush_ = stream;

  // ASCII with nothing held: no sequence to finish, and no BOM to drop.
  if (!decoder_.pending() && isAscii(bytes, n)) {
    if (n) bomSeen_ = true;
    return String::fromLatin1(std::string_view(reinterpret_cast<const char*>(bytes), n));
  }

  std::u16string out;
  out.reserve(n);
  if (!decoder_.decode(bytes, n, !stream, fatal, out))
    throwTypeError("The encoded data was not valid for encoding utf-8");
  if (!ignoreBOM && !bomSeen_ && !out.empty()) {
    bomSeen_ = true;
    if (out.front() == 0xFEFF) out.erase(0, 1);
  }
  return String::fromUtf16(out);
}

TextDecoder makeTextDecoder(const Opt<String>& label, bool fatal, bool ignoreBOM) {
  if (label.has()) {
    // Without the ASCII whitespace around it, in lowercase.
    std::string name = label.get().toUtf8();
    const auto space = [](char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\f' || c == '\r'; };
    size_t start = 0;
    size_t stop = name.size();
    while (start < stop && space(name[start])) start++;
    while (stop > start && space(name[stop - 1])) stop--;
    std::string key = name.substr(start, stop - start);
    for (char& c : key)
      if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
    bool utf8 = false;
    for (std::string_view l : kUtf8Labels) utf8 = utf8 || key == l;
    if (!utf8) throwRangeError(("The \"" + name + "\" encoding is not supported").c_str());
  }
  return std::make_shared<TextDecoderObject>(fatal, ignoreBOM);
}

}  // namespace lucent
