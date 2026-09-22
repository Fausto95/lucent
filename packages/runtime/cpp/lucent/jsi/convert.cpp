#include "convert.h"

#include <cstring>

namespace lucent::js {

const char* jsTypeName(jsi::Runtime& rt, const jsi::Value& v) {
  if (v.isUndefined()) return "undefined";
  if (v.isNull()) return "null";
  if (v.isBool()) return "a boolean";
  if (v.isNumber()) return "a number";
  if (v.isString()) return "a string";
  if (v.isBigInt()) return "a bigint";
  if (v.isSymbol()) return "a symbol";
  jsi::Object o = v.getObject(rt);
  if (o.isArray(rt)) return "an array";
  if (o.isFunction(rt)) return "a function";
  return "an object";
}

void throwBoundaryError(jsi::Runtime& rt, const Path& path, const char* expected, const jsi::Value& actual) {
  std::string message = std::string(path.fn) + ": " + path.where + " must be " + expected + ", got " + jsTypeName(rt, actual);
  jsi::Object err = rt.global()
                        .getPropertyAsFunction(rt, "TypeError")
                        .callAsConstructor(rt, jsi::String::createFromUtf8(rt, message))
                        .getObject(rt);
  throw jsi::JSError(rt, jsi::Value(rt, err));
}

String stringFromJs(jsi::Runtime& rt, const jsi::String& s) {
  struct Acc {
    std::string ascii;
    std::u16string wide;
    bool isWide = false;
  } acc;
  auto collect = [&acc](bool ascii, const void* data, size_t num) {
    if (ascii && !acc.isWide) {
      acc.ascii.append(static_cast<const char*>(data), num);
      return;
    }
    if (!acc.isWide) {
      acc.isWide = true;
      acc.wide.reserve(acc.ascii.size() + num);
      for (unsigned char c : acc.ascii) acc.wide.push_back(c);
      acc.ascii.clear();
    }
    if (ascii) {
      const char* p = static_cast<const char*>(data);
      for (size_t i = 0; i < num; i++) acc.wide.push_back(static_cast<unsigned char>(p[i]));
    } else {
      acc.wide.append(static_cast<const char16_t*>(data), num);
    }
  };
  s.getStringData(rt, collect);
  if (!acc.isWide) return String::fromLatin1(acc.ascii);
  return String::fromUtf16(acc.wide);
}

jsi::String stringToJs(jsi::Runtime& rt, const String& s) {
  if (s.isOneByte()) {
    std::string_view b = s.latin1();
    bool ascii = true;
    for (unsigned char c : b) {
      if (c >= 0x80) {
        ascii = false;
        break;
      }
    }
    if (ascii) return jsi::String::createFromAscii(rt, b.data(), b.size());
    std::u16string w = s.toUtf16();
    return jsi::String::createFromUtf16(rt, w.data(), w.size());
  }
  std::u16string_view w = s.utf16();
  return jsi::String::createFromUtf16(rt, w.data(), w.size());
}

bool isInstanceOf(jsi::Runtime& rt, const jsi::Object& o, const char* ctor) {
  jsi::Value c = rt.global().getProperty(rt, ctor);
  if (!c.isObject() || !c.getObject(rt).isFunction(rt)) return false;
  return o.instanceOf(rt, c.getObject(rt).getFunction(rt));
}

namespace {
class OwnedBuffer : public jsi::MutableBuffer {
 public:
  explicit OwnedBuffer(std::vector<uint8_t> data) : data_(std::move(data)) {}
  size_t size() const override { return data_.size(); }
  uint8_t* data() override { return data_.data(); }

 private:
  std::vector<uint8_t> data_;
};
}  // namespace

Bytes Convert<Bytes>::fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
  if (!v.isObject()) throwBoundaryError(rt, p, "a Uint8Array", v);
  jsi::Object o = v.getObject(rt);
  if (o.isArrayBuffer(rt)) {
    jsi::ArrayBuffer ab = o.getArrayBuffer(rt);
    return Bytes::copy(ab.data(rt), ab.size(rt));
  }
  if (!isInstanceOf(rt, o, "Uint8Array")) throwBoundaryError(rt, p, "a Uint8Array", v);
  jsi::ArrayBuffer ab = o.getPropertyAsObject(rt, "buffer").getArrayBuffer(rt);
  size_t offset = static_cast<size_t>(o.getProperty(rt, "byteOffset").getNumber());
  size_t length = static_cast<size_t>(o.getProperty(rt, "byteLength").getNumber());
  return Bytes::copy(ab.data(rt) + offset, length);
}

jsi::Value Convert<Bytes>::toJs(jsi::Runtime& rt, Host&, const Bytes& b) {
  auto buffer = std::make_shared<OwnedBuffer>(std::vector<uint8_t>(b.data(), b.data() + b.size()));
  jsi::ArrayBuffer ab(rt, buffer);
  return rt.global().getPropertyAsFunction(rt, "Uint8Array").callAsConstructor(rt, ab);
}

Error Convert<Error>::fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path&) {
  Error e = makeError(String::fromLatin1("Error"), String());
  if (v.isObject()) {
    jsi::Object o = v.getObject(rt);
    jsi::Value name = o.getProperty(rt, "name");
    jsi::Value message = o.getProperty(rt, "message");
    jsi::Value code = o.getProperty(rt, "code");
    jsi::Value stack = o.getProperty(rt, "stack");
    if (name.isString()) e->name = stringFromJs(rt, name.getString(rt));
    if (message.isString()) e->message = stringFromJs(rt, message.getString(rt));
    if (code.isString()) e->code = stringFromJs(rt, code.getString(rt));
    if (stack.isString()) e->stack = stringFromJs(rt, stack.getString(rt));
  } else {
    e->message = stringFromJs(rt, v.toString(rt));
  }
  return e;
}

}  // namespace lucent::js
