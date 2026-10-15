#include "entries.h"

#include <mutex>

#include "trace.h"

namespace lucent::entries {

void launch(ModuleInitializer init) {
  static std::once_flag once;
  std::call_once(once, [init] {
    LUCENT_TRACE_SCOPE("lucent.launch");
    // The process's: never released.
    static auto* held = new ModuleStateHold();
    (void)held;
    ensureModuleState(init);
  });
}

lucent_string Kept::keep(const std::string& s) {
  strings_.push_back(s);
  const std::string& kept = strings_.back();
  return lucent_string{kept.data(), kept.size()};
}

lucent_string Kept::keep(const String& s) { return keep(s.toUtf8()); }

lucent_bytes Kept::keep(const Bytes& b) {
  bytes_.emplace_back(b.data(), b.data() + b.size());
  const std::vector<uint8_t>& kept = bytes_.back();
  return lucent_bytes{kept.data(), kept.size()};
}

void* Kept::keep(const NativeRef& r) {
  objects_.push_back(r);
  return objects_.back().get();
}

lucent_value* Kept::values(size_t n) {
  values_.emplace_back(n, lucent_value{LUCENT_NULL, {}});
  return values_.back().data();
}

lucent_string* Kept::keys(size_t n) {
  keys_.emplace_back(n, lucent_string{nullptr, 0});
  return keys_.back().data();
}

void Kept::clear() {
  strings_.clear();
  bytes_.clear();
  values_.clear();
  keys_.clear();
  objects_.clear();
}

namespace detail {

static const char* kindName(lucent_kind kind) {
  switch (kind) {
    case LUCENT_NULL:
      return "null";
    case LUCENT_BOOLEAN:
      return "a boolean";
    case LUCENT_NUMBER:
      return "a number";
    case LUCENT_BIGINT:
      return "a bigint";
    case LUCENT_STRING:
      return "a string";
    case LUCENT_BYTES:
      return "bytes";
    case LUCENT_ARRAY:
      return "an array";
    case LUCENT_RECORD:
      return "a record";
    case LUCENT_PLATFORM_OBJECT:
      return "a platform object";
  }
  return "a value of unknown kind";
}

void wrongKind(lucent_kind got, const char* expected) {
  throwTypeError((std::string("A native entry was given ") + kindName(got) + " where it takes " + expected).c_str());
}

}  // namespace detail

Kept& threadKept() {
  thread_local Kept kept;
  return kept;
}

lucent_error errorOf(Kept& k, const Error& error) {
  if (!error) return lucent_error{k.keep(std::string("Error")), k.keep(std::string()), k.keep(std::string())};
  return lucent_error{k.keep(error->name), k.keep(error->message), error->code.has() ? k.keep(error->code.value()) : k.keep(std::string())};
}

}  // namespace lucent::entries
