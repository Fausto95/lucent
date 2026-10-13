#include "entries.h"

namespace lucent::entries {

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

void Kept::clear() {
  strings_.clear();
  bytes_.clear();
}

Kept& threadKept() {
  thread_local Kept kept;
  return kept;
}

lucent_error errorOf(Kept& k, const Error& error) {
  if (!error) return lucent_error{k.keep(std::string("Error")), k.keep(std::string()), k.keep(std::string())};
  return lucent_error{k.keep(error->name), k.keep(error->message), error->code.has() ? k.keep(error->code.value()) : k.keep(std::string())};
}

}  // namespace lucent::entries
