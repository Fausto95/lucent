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

namespace {

/// `sumPoints: argument 'ps'[3].x must be a number, got a string`
[[noreturn]] void throwMismatch(jsi::Runtime& rt, const Path& path, const char* expected, const std::string& got) {
  std::string message = path.function() + ": " + path.where() + " must be " + expected + ", got " + got;
  jsi::Object err = rt.global()
                        .getPropertyAsFunction(rt, "TypeError")
                        .callAsConstructor(rt, jsi::String::createFromUtf8(rt, message))
                        .getObject(rt);
  throw jsi::JSError(rt, jsi::Value(rt, err));
}

}  // namespace

void throwBoundaryError(jsi::Runtime& rt, const Path& path, const char* expected, const jsi::Value& actual) {
  throwMismatch(rt, path, expected, jsTypeName(rt, actual));
}

void throwUnknownDiscriminant(jsi::Runtime& rt, const Path& path, const char* accepted, const jsi::Value& got) {
  // A string reads as the literal it is, like the accepted values.
  std::string shown = got.isString() ? rt.global()
                                           .getPropertyAsObject(rt, "JSON")
                                           .getPropertyAsFunction(rt, "stringify")
                                           .call(rt, got)
                                           .getString(rt)
                                           .utf8(rt)
                                     : jsTypeName(rt, got);
  throwMismatch(rt, path, accepted, shown);
}

BigInt Convert<BigInt>::fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
  if (!v.isBigInt()) throwBoundaryError(rt, p, "a bigint", v);

  jsi::BigInt b = v.getBigInt(rt);

  if (b.isInt64(rt)) return BigInt::fromInt64(b.getInt64(rt));
  if (b.isUint64(rt)) return BigInt::fromUint64(b.getUint64(rt));

  // Beyond 64 bits: its hex digits, after a "-" when negative.
  return BigInt::fromDigits(b.toString(rt, 16).utf8(rt), 16);
}

jsi::Value Convert<BigInt>::toJs(jsi::Runtime& rt, Host&, const BigInt& v) {
  if (auto i = v.tryInt64()) return jsi::Value(jsi::BigInt::fromInt64(rt, *i));
  if (auto u = v.tryUint64()) return jsi::Value(jsi::BigInt::fromUint64(rt, *u));

  // Beyond 64 bits: BigInt(string) builds it. Decimal, since BigInt()
  // takes no sign before a 0x prefix.
  jsi::Function make = rt.global().getPropertyAsFunction(rt, "BigInt");
  return make.call(rt, jsi::String::createFromAscii(rt, v.toString().toUtf8()));
}

String stringFromJs(jsi::Runtime& rt, const jsi::String& s) {
  // Hermes hands most strings over in one chunk: an ASCII one becomes the
  // String directly (inline when short). Later chunks go to the accumulator.
  struct Acc {
    String first;
    size_t chunks = 0;
    std::string ascii;
    std::u16string wide;
    bool isWide = false;
  } acc;
  auto collect = [&acc](bool ascii, const void* data, size_t num) {
    if (acc.chunks++ == 0 && ascii) {
      acc.first = String::fromLatin1(std::string_view(static_cast<const char*>(data), num));
      return;
    }
    if (acc.chunks == 2 && acc.first.length() > 0) acc.ascii.assign(acc.first.latin1());
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
  if (acc.chunks == 1 && !acc.isWide && acc.ascii.empty()) return acc.first;
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

/// Bytes no Lucent code holds (a fresh copy), lent to an ArrayBuffer as they are.
class FreshBytes : public jsi::MutableBuffer {
 public:
  explicit FreshBytes(Bytes bytes) : bytes_(std::move(bytes)) {}
  size_t size() const override { return bytes_.size(); }
  uint8_t* data() override { return bytes_.data(); }
  const Bytes& bytes() const { return bytes_; }

 private:
  Bytes bytes_;
};

/// Storage only JavaScript holds from now on: a buffer Lucent code let go of.
class HeldStorage : public jsi::MutableBuffer {
 public:
  explicit HeldStorage(Storage storage) : storage_(std::move(storage)) {}
  size_t size() const override { return storage_->size(); }
  uint8_t* data() override { return storage_->data(); }

 private:
  Storage storage_;
};

/// A JavaScript ArrayBuffer over `storage`, which no Lucent code holds, its
/// size reported to the collector so a large one goes when it is dropped.
jsi::ArrayBuffer movedBuffer(jsi::Runtime& rt, Storage storage) {
  size_t size = storage->size();
  jsi::ArrayBuffer ab(rt, std::make_shared<HeldStorage>(std::move(storage)));
  if (size > 0) ab.setExternalMemoryPressure(rt, size);
  return ab;
}

jsi::Value uint8ArrayOver(jsi::Runtime& rt, const std::shared_ptr<FreshBytes>& bytes) {
  jsi::ArrayBuffer ab(rt, bytes);
  return rt.global().getPropertyAsFunction(rt, "Uint8Array").callAsConstructor(rt, ab);
}
}  // namespace

namespace {
/// The bytes a Uint8Array argument views (an ArrayBuffer's, whole): where
/// they start and how many there are.
std::pair<uint8_t*, size_t> viewedBytes(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
  if (!v.isObject()) throwBoundaryError(rt, p, "a Uint8Array", v);
  jsi::Object o = v.getObject(rt);
  if (o.isArrayBuffer(rt)) {
    jsi::ArrayBuffer ab = o.getArrayBuffer(rt);
    return {ab.data(rt), ab.size(rt)};
  }
  if (!isInstanceOf(rt, o, "Uint8Array")) throwBoundaryError(rt, p, "a Uint8Array", v);
  jsi::ArrayBuffer ab = o.getPropertyAsObject(rt, "buffer").getArrayBuffer(rt);
  size_t offset = static_cast<size_t>(o.getProperty(rt, "byteOffset").getNumber());
  size_t length = static_cast<size_t>(o.getProperty(rt, "byteLength").getNumber());
  return {ab.data(rt) + offset, length};
}
}  // namespace

Bytes Convert<Bytes>::fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
  auto [data, size] = viewedBytes(rt, v, p);
  return Bytes::copy(data, size);
}

Borrowed<Bytes> Convert<Bytes>::borrow(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
  auto [data, size] = viewedBytes(rt, v, p);
  return Borrowed<Bytes>(Bytes::over(ArrayBuffer(ByteStorage::lend(data, size))));
}

jsi::Value Convert<Bytes>::toJs(jsi::Runtime& rt, Host&, const Bytes& b) {
  auto buffer = std::make_shared<OwnedBuffer>(std::vector<uint8_t>(b.data(), b.data() + b.size()));
  jsi::ArrayBuffer ab(rt, buffer);
  return rt.global().getPropertyAsFunction(rt, "Uint8Array").callAsConstructor(rt, ab);
}

jsi::Value Convert<Bytes>::toJs(jsi::Runtime& rt, Host& h, Bytes&& b) {
  // A view of part of its buffer would show JavaScript the rest (`u8.buffer`), which a copy does not.
  bool whole = b.offset() == 0 && b.size() == b.buffer()->size();
  if (!whole || b.buffer().use_count() != 1 || b.buffer()->lent()) return toJs(rt, h, static_cast<const Bytes&>(b));
  jsi::ArrayBuffer ab = movedBuffer(rt, b.buffer());
  return rt.global().getPropertyAsFunction(rt, "Uint8Array").callAsConstructor(rt, ab);
}

namespace {
/// "a Float32Array", "an Int8Array".
std::string aName(const char* name) {
  return std::string(std::strchr("AEIOU", name[0]) ? "an " : "a ") + name;
}
}  // namespace

std::pair<uint8_t*, size_t> typedView(jsi::Runtime& rt, const jsi::Value& v, const Path& p, const char* name, size_t element) {
  if (!v.isObject() || !isInstanceOf(rt, v.getObject(rt), name)) throwBoundaryError(rt, p, aName(name).c_str(), v);
  jsi::Object o = v.getObject(rt);
  jsi::ArrayBuffer ab = o.getPropertyAsObject(rt, "buffer").getArrayBuffer(rt);
  size_t offset = static_cast<size_t>(o.getProperty(rt, "byteOffset").getNumber());
  size_t length = static_cast<size_t>(o.getProperty(rt, "byteLength").getNumber());
  return {ab.data(rt) + offset, length / element};
}

jsi::Value typedCopy(jsi::Runtime& rt, const char* name, const uint8_t* data, size_t size) {
  auto buffer = std::make_shared<OwnedBuffer>(std::vector<uint8_t>(data, data + size));
  jsi::ArrayBuffer ab(rt, buffer);
  return rt.global().getPropertyAsFunction(rt, name).callAsConstructor(rt, ab);
}

jsi::Value typedMoved(jsi::Runtime& rt, const char* name, Storage storage) {
  jsi::ArrayBuffer ab = movedBuffer(rt, std::move(storage));
  return rt.global().getPropertyAsFunction(rt, name).callAsConstructor(rt, ab);
}

DataView Convert<DataView>::fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
  if (!v.isObject() || !isInstanceOf(rt, v.getObject(rt), "DataView")) throwBoundaryError(rt, p, "a DataView", v);
  jsi::Object o = v.getObject(rt);
  jsi::ArrayBuffer ab = o.getPropertyAsObject(rt, "buffer").getArrayBuffer(rt);
  size_t offset = static_cast<size_t>(o.getProperty(rt, "byteOffset").getNumber());
  size_t length = static_cast<size_t>(o.getProperty(rt, "byteLength").getNumber());
  return DataView::over(ArrayBuffer::copy(ab.data(rt) + offset, length));
}

jsi::Value Convert<DataView>::toJs(jsi::Runtime& rt, Host&, const DataView& d) {
  const uint8_t* data = d.storage()->data() + d.offset();
  return typedCopy(rt, "DataView", data, d.size());
}

ArrayBuffer Convert<ArrayBuffer>::fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
  if (!v.isObject() || !v.getObject(rt).isArrayBuffer(rt)) throwBoundaryError(rt, p, "an ArrayBuffer", v);
  jsi::ArrayBuffer ab = v.getObject(rt).getArrayBuffer(rt);
  return ArrayBuffer::copy(ab.data(rt), ab.size(rt));
}

Borrowed<ArrayBuffer> Convert<ArrayBuffer>::borrow(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
  if (!v.isObject() || !v.getObject(rt).isArrayBuffer(rt)) throwBoundaryError(rt, p, "an ArrayBuffer", v);
  jsi::ArrayBuffer ab = v.getObject(rt).getArrayBuffer(rt);
  return Borrowed<ArrayBuffer>(ArrayBuffer(ByteStorage::lend(ab.data(rt), ab.size(rt))));
}

jsi::Value Convert<ArrayBuffer>::toJs(jsi::Runtime& rt, Host&, const ArrayBuffer& b) {
  auto buffer = std::make_shared<OwnedBuffer>(std::vector<uint8_t>(b.data(), b.data() + b.size()));
  return jsi::ArrayBuffer(rt, buffer);
}

jsi::Value Convert<ArrayBuffer>::toJs(jsi::Runtime& rt, Host& h, ArrayBuffer&& b) {
  if (!b.unshared() || b.storage()->lent()) return toJs(rt, h, static_cast<const ArrayBuffer&>(b));
  return movedBuffer(rt, b.storage());
}

namespace {
const char* const kBufferPrototype = "lucent:NativeBuffer";

NativeBuffer bufferThis(jsi::Runtime& rt, const jsi::Value& self, const char* method) {
  return Convert<NativeBuffer>::fromJs(rt, self, Path{method, "this"});
}

jsi::Function callbackArg(jsi::Runtime& rt, const jsi::Value* args, size_t count, const char* method) {
  const jsi::Value& f = arg(args, count, 0);
  if (!f.isObject() || !f.getObject(rt).isFunction(rt)) throwBoundaryError(rt, Path{method, "argument 0"}, "a function", f);

  return f.getObject(rt).getFunction(rt);
}

/// A method of the handle, calling `body(rt, host, buffer, args, count)`.
template <class F>
jsi::Function bufferMethod(jsi::Runtime& rt, const char* name, unsigned argc, F body) {
  return jsi::Function::createFromHostFunction(
      rt, jsi::PropNameID::forAscii(rt, name), argc,
      [name, body](jsi::Runtime& rt, const jsi::Value& self, const jsi::Value* args, size_t count) -> jsi::Value {
        Host& host = Host::get(rt);
        jsi::Value result = callSync(rt, host, [&] { return body(rt, host, bufferThis(rt, self, name), args, count); });
        // A transfer or a close leaves it holding nothing: the collector counts that.
        reportNativeSize(rt, self);
        return result;
      });
}

void bufferPrototype(jsi::Runtime& rt, Host&, jsi::Object& proto) {
  defineAccessor(
      rt, proto, "byteLength",
      [](jsi::Runtime& rt, const jsi::Value& self, const jsi::Value*, size_t) {
        return jsi::Value(static_cast<double>(bufferThis(rt, self, "NativeBuffer.byteLength")->size()));
      },
      nullptr);

  proto.setProperty(rt, "toUint8Array",
                    bufferMethod(rt, "toUint8Array", 0, [](jsi::Runtime& rt, Host&, const NativeBuffer& b, const jsi::Value*, size_t) {
                      return uint8ArrayOver(rt, std::make_shared<FreshBytes>(b->toBytes()));
                    }));

  proto.setProperty(rt, "withRead",
                    bufferMethod(rt, "withRead", 1, [](jsi::Runtime& rt, Host&, const NativeBuffer& b, const jsi::Value* args, size_t count) {
                      jsi::Function read = callbackArg(rt, args, count, "withRead");

                      return b->withRead([&](std::span<const uint8_t> bytes) {
                        return read.call(rt, uint8ArrayOver(rt, std::make_shared<FreshBytes>(NativeBufferObject::copyOut(bytes))));
                      });
                    }));

  proto.setProperty(rt, "withWrite",
                    bufferMethod(rt, "withWrite", 1, [](jsi::Runtime& rt, Host&, const NativeBuffer& b, const jsi::Value* args, size_t count) {
                      jsi::Function write = callbackArg(rt, args, count, "withWrite");

                      return b->withWrite([&](std::span<uint8_t> bytes) {
                        auto lent = std::make_shared<FreshBytes>(NativeBufferObject::copyOut(bytes));

                        // What the callback wrote comes back, even if it then threw.
                        struct CopyBack {
                          std::span<uint8_t> to;
                          const FreshBytes& from;
                          ~CopyBack() { NativeBufferObject::copyIn(to, from.bytes()); }
                        } back{bytes, *lent};

                        return write.call(rt, uint8ArrayOver(rt, lent));
                      });
                    }));

  proto.setProperty(rt, "transfer",
                    bufferMethod(rt, "transfer", 0, [](jsi::Runtime& rt, Host& host, const NativeBuffer& b, const jsi::Value*, size_t) {
                      return Convert<NativeBuffer>::toJs(rt, host, b->transfer());
                    }));

  // JavaScript's ArrayBuffer over the bytes themselves: no Lucent code holds them any more.
  proto.setProperty(rt, "transferToArrayBuffer",
                    bufferMethod(rt, "transferToArrayBuffer", 0,
                                 [](jsi::Runtime& rt, Host& host, const NativeBuffer& b, const jsi::Value*, size_t) {
                                   return Convert<ArrayBuffer>::toJs(rt, host, b->transferToArrayBuffer());
                                 }));

  jsi::Function close = bufferMethod(rt, "close", 0, [](jsi::Runtime&, Host&, const NativeBuffer& b, const jsi::Value*, size_t) {
    b->close();
    return jsi::Value::undefined();
  });

  // `using` in JavaScript, where the runtime has Symbol.dispose.
  jsi::Value dispose = rt.global().getPropertyAsObject(rt, "Symbol").getProperty(rt, "dispose");
  if (dispose.isSymbol()) {
    jsi::Object descriptor(rt);
    descriptor.setProperty(rt, "value", jsi::Value(rt, close));
    descriptor.setProperty(rt, "configurable", true);
    descriptor.setProperty(rt, "writable", true);
    rt.global().getPropertyAsObject(rt, "Object").getPropertyAsFunction(rt, "defineProperty").call(rt, proto, dispose, descriptor);
  }

  proto.setProperty(rt, "close", std::move(close));

  proto.setProperty(rt, "handle",
                    bufferMethod(rt, "handle", 0, [](jsi::Runtime& rt, Host& host, const NativeBuffer& b, const jsi::Value*, size_t) {
                      return Convert<NativeHandle>::toJs(rt, host, b->handle());
                    }));
}

const char* const kHandlePrototype = "lucent:NativeHandle";

NativeHandle handleThis(jsi::Runtime& rt, const jsi::Value& self, const char* member) {
  return Convert<NativeHandle>::fromJs(rt, self, Path{member, "this"});
}

void handlePrototype(jsi::Runtime& rt, Host&, jsi::Object& proto) {
  defineAccessor(
      rt, proto, "pointer",
      [](jsi::Runtime& rt, const jsi::Value& self, const jsi::Value*, size_t) {
        return jsi::Value(jsi::BigInt::fromUint64(rt, handleThis(rt, self, "NativeHandle.pointer")->pointer()));
      },
      nullptr);
  defineAccessor(
      rt, proto, "released",
      [](jsi::Runtime& rt, const jsi::Value& self, const jsi::Value*, size_t) {
        return jsi::Value(handleThis(rt, self, "NativeHandle.released")->released());
      },
      nullptr);
  proto.setProperty(rt, "release",
                    jsi::Function::createFromHostFunction(
                        rt, jsi::PropNameID::forAscii(rt, "release"), 0,
                        [](jsi::Runtime& rt, const jsi::Value& self, const jsi::Value*, size_t) -> jsi::Value {
                          Host& host = Host::get(rt);
                          return callSync(rt, host, [&] { return jsi::Value(handleThis(rt, self, "release")->release()); });
                        }));
}
}  // namespace

NativeHandle Convert<NativeHandle>::fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
  if (auto h = std::dynamic_pointer_cast<NativeHandleObject>(instanceOf(rt, v))) return h;

  throwBoundaryError(rt, p, "a NativeHandle", v);
}

jsi::Value Convert<NativeHandle>::toJs(jsi::Runtime& rt, Host& h, const NativeHandle& handle) {
  return h.wrap(rt, handle, kHandlePrototype, handlePrototype);
}

NativeBuffer Convert<NativeBuffer>::fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
  if (auto b = std::dynamic_pointer_cast<NativeBufferObject>(instanceOf(rt, v))) return b;

  throwBoundaryError(rt, p, "a NativeBuffer", v);
}

jsi::Value Convert<NativeBuffer>::toJs(jsi::Runtime& rt, Host& h, const NativeBuffer& b) {
  return h.wrap(rt, b, kBufferPrototype, bufferPrototype);
}

Error Convert<Error>::fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path&) {
  if (auto own = std::dynamic_pointer_cast<ErrorObject>(instanceOf(rt, v))) return own;
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

namespace {
struct SignalState : jsi::NativeState {
  explicit SignalState(AbortSignal s) : signal(std::move(s)) {}
  AbortSignal signal;
};

Error abortReason(jsi::Runtime& rt, const jsi::Value& signal) {
  jsi::Value reason = signal.isObject() ? signal.getObject(rt).getProperty(rt, "reason") : jsi::Value::undefined();
  return reason.isUndefined() ? abortError() : Convert<Error>::fromJs(rt, reason, Path{"AbortSignal", "reason"});
}
}  // namespace

AbortSignal Convert<AbortSignal>::fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
  if (!v.isObject()) throwBoundaryError(rt, p, "an AbortSignal", v);
  jsi::Object o = v.getObject(rt);
  if (o.hasNativeState<SignalState>(rt)) return o.getNativeState<SignalState>(rt)->signal;
  jsi::Value aborted = o.getProperty(rt, "aborted");
  jsi::Value add = o.getProperty(rt, "addEventListener");
  if (!aborted.isBool() || !add.isObject() || !add.getObject(rt).isFunction(rt)) throwBoundaryError(rt, p, "an AbortSignal", v);
  auto signal = std::make_shared<AbortSignalObject>();
  if (aborted.getBool()) {
    signal->abort(abortReason(rt, v));
  } else {
    // The JS signal owns the native one (NativeState below); the listener
    // only refers to it.
    std::weak_ptr<AbortSignalObject> weak = signal;
    jsi::Function onAbort = jsi::Function::createFromHostFunction(
        rt, jsi::PropNameID::forAscii(rt, "onAbort"), 1,
        [weak](jsi::Runtime& rt, const jsi::Value& thisVal, const jsi::Value* args, size_t count) -> jsi::Value {
          auto s = weak.lock();
          if (!s) return jsi::Value::undefined();
          jsi::Value target = count > 0 && args[0].isObject() ? args[0].getObject(rt).getProperty(rt, "target") : jsi::Value(rt, thisVal);
          return callSync(rt, Host::get(rt), [&]() -> jsi::Value {
            s->abort(abortReason(rt, target));
            return jsi::Value::undefined();
          });
        });
    add.getObject(rt).getFunction(rt).callWithThis(rt, o, jsi::String::createFromAscii(rt, "abort"), onAbort);
  }
  o.setNativeState(rt, std::make_shared<SignalState>(signal));
  return signal;
}

Date Convert<Date>::fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
  if (v.isObject()) {
    jsi::Object o = v.getObject(rt);
    jsi::Value getTime = o.getProperty(rt, "getTime");
    if (getTime.isObject() && getTime.getObject(rt).isFunction(rt)) {
      jsi::Value t = getTime.getObject(rt).getFunction(rt).callWithThis(rt, o);
      if (t.isNumber()) return makeDate(t.getNumber());
    }
  }
  throwBoundaryError(rt, p, "a Date", v);
}

jsi::Value Convert<Date>::toJs(jsi::Runtime& rt, Host&, const Date& d) {
  return rt.global().getPropertyAsFunction(rt, "Date").callAsConstructor(rt, d->getTime());
}

jsi::Value rejectedPromise(jsi::Runtime& rt, const jsi::Value& reason) {
  jsi::Object promise = rt.global().getPropertyAsObject(rt, "Promise");
  return promise.getPropertyAsFunction(rt, "reject").callWithThis(rt, promise, reason);
}

}  // namespace lucent::js
