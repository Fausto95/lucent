// In a directory of its own, which the runtime's builds and harnesses that
// glob lucent/*.cpp leave out: it needs Ada (third_party/ada) to link.
#include "../url.h"

#include <optional>
#include <string>
#include <string_view>

// As lucent_ada.cpp compiles Ada: without URLPattern.
#define ADA_INCLUDE_URL_PATTERN 0
#include "../../third_party/ada/ada.h"

#include "../jserror.h"
#include "../text.h"

namespace lucent {

namespace {

/// Ada's UTF-8, as a string: decoded as the standard decodes it, without a BOM's special case.
String fromAda(std::string_view text) {
  return utf8DecodeBytes(reinterpret_cast<const uint8_t*>(text.data()), text.size());
}

/// Text as UTF-8 decodes it, the standard's way: bytes that aren't UTF-8 are U+FFFD's.
std::string wellFormed(std::string_view text) { return fromAda(text).toUtf8(); }

/**
 * A query's pairs, parsed: as Ada parses them, each name and value then
 * decoded as the standard says, where Ada keeps the bytes a percent-escape
 * gave even when they aren't UTF-8 (`%FF`).
 */
ada::url_search_params parsedQuery(std::string_view text) {
  ada::url_search_params raw(text);
  ada::url_search_params out;
  for (size_t i = 0; i < raw.size(); i++) {
    const auto pair = raw[i];
    out.append(wellFormed(pair.first), wellFormed(pair.second));
  }
  return out;
}

std::optional<ada::url_aggregator> parsed(const String& input, const Opt<String>& base) {
  const std::string in = input.toUtf8();
  if (!base.has()) {
    auto url = ada::parse<ada::url_aggregator>(in);
    if (!url) return std::nullopt;
    return std::move(*url);
  }
  auto against = ada::parse<ada::url_aggregator>(base.get().toUtf8());
  if (!against) return std::nullopt;
  auto url = ada::parse<ada::url_aggregator>(in, &*against);
  if (!url) return std::nullopt;
  return std::move(*url);
}

[[noreturn]] void invalidUrl() { throwTypeError("Invalid URL"); }

}  // namespace

struct URLObject::Impl {
  ada::url_aggregator url;
};

struct URLSearchParamsObject::Impl {
  ada::url_search_params params;
};

// --- URL ------------------------------------------------------------------------------------

URLObject::URLObject() : impl_(std::make_unique<Impl>()) {}
URLObject::~URLObject() = default;

URL URLObject::make(const String& input, const Opt<String>& base) {
  auto url = parsed(input, base);
  if (!url) invalidUrl();
  auto out = std::make_shared<URLObject>();
  out->impl_->url = std::move(*url);
  return out;
}

Opt<URL> URLObject::parse(const String& input, const Opt<String>& base) {
  auto url = parsed(input, base);
  if (!url) return null;
  auto out = std::make_shared<URLObject>();
  out->impl_->url = std::move(*url);
  return URL(out);
}

bool URLObject::canParse(const String& input, const Opt<String>& base) { return parsed(input, base).has_value(); }

String URLObject::href() const { return fromAda(impl_->url.get_href()); }
void URLObject::setHref(const String& value) {
  if (!impl_->url.set_href(value.toUtf8())) invalidUrl();
  queryChanged();
}
String URLObject::origin() const { return fromAda(impl_->url.get_origin()); }
String URLObject::protocol() const { return fromAda(impl_->url.get_protocol()); }
void URLObject::setProtocol(const String& value) { impl_->url.set_protocol(value.toUtf8()); }
String URLObject::username() const { return fromAda(impl_->url.get_username()); }
void URLObject::setUsername(const String& value) { impl_->url.set_username(value.toUtf8()); }
String URLObject::password() const { return fromAda(impl_->url.get_password()); }
void URLObject::setPassword(const String& value) { impl_->url.set_password(value.toUtf8()); }
String URLObject::host() const { return fromAda(impl_->url.get_host()); }
void URLObject::setHost(const String& value) { impl_->url.set_host(value.toUtf8()); }
String URLObject::hostname() const { return fromAda(impl_->url.get_hostname()); }
void URLObject::setHostname(const String& value) { impl_->url.set_hostname(value.toUtf8()); }
String URLObject::port() const { return fromAda(impl_->url.get_port()); }
void URLObject::setPort(const String& value) { impl_->url.set_port(value.toUtf8()); }
String URLObject::pathname() const { return fromAda(impl_->url.get_pathname()); }
void URLObject::setPathname(const String& value) { impl_->url.set_pathname(value.toUtf8()); }
String URLObject::search() const { return fromAda(impl_->url.get_search()); }
void URLObject::setSearch(const String& value) {
  impl_->url.set_search(value.toUtf8());
  queryChanged();
}
String URLObject::hash() const { return fromAda(impl_->url.get_hash()); }
void URLObject::setHash(const String& value) { impl_->url.set_hash(value.toUtf8()); }

URLSearchParams URLObject::searchParams() {
  if (!params_) {
    params_ = std::make_shared<URLSearchParamsObject>();
    params_->impl_->params = parsedQuery(impl_->url.get_search());
    params_->url_ = std::static_pointer_cast<URLObject>(shared_from_this());
  }
  return params_;
}

void URLObject::queryChanged() {
  if (params_) params_->impl_->params = parsedQuery(impl_->url.get_search());
}

void URLObject::paramsChanged(const std::string& serialized) { impl_->url.set_search(serialized); }

// --- URLSearchParams ------------------------------------------------------------------------

URLSearchParamsObject::URLSearchParamsObject() : impl_(std::make_unique<Impl>()) {}
URLSearchParamsObject::~URLSearchParamsObject() = default;

URLSearchParams URLSearchParamsObject::fromString(const String& init) {
  auto out = std::make_shared<URLSearchParamsObject>();
  out->impl_->params = parsedQuery(init.toUtf8());
  return out;
}

URLSearchParams URLSearchParamsObject::fromPairs(const Array<Array<String>>& pairs) {
  auto out = std::make_shared<URLSearchParamsObject>();
  for (const auto& pair : pairs.items()) {
    if (pair.length() != 2) throwTypeError("Each query pair must be an iterable [name, value] tuple");
    out->impl_->params.append(pair.items()[0].toUtf8(), pair.items()[1].toUtf8());
  }
  return out;
}

URLSearchParams URLSearchParamsObject::fromTuples(const Array<std::tuple<String, String>>& pairs) {
  auto out = std::make_shared<URLSearchParamsObject>();
  for (const auto& [name, value] : pairs.items()) out->impl_->params.append(name.toUtf8(), value.toUtf8());
  return out;
}

URLSearchParams URLSearchParamsObject::fromRecord(const Dict<String>& record) {
  auto out = std::make_shared<URLSearchParamsObject>();
  const Array<String> keys = record.keys();
  for (const auto& key : keys.items()) out->impl_->params.append(key.toUtf8(), record.get(key).get().toUtf8());
  return out;
}

URLSearchParams URLSearchParamsObject::copy(const URLSearchParams& other) {
  auto out = std::make_shared<URLSearchParamsObject>();
  out->impl_->params = other->impl_->params;
  return out;
}

void URLSearchParamsObject::append(const String& name, const String& value) {
  impl_->params.append(name.toUtf8(), value.toUtf8());
  changed();
}

void URLSearchParamsObject::remove(const String& name, const Opt<String>& value) {
  if (value.has()) impl_->params.remove(name.toUtf8(), value.get().toUtf8());
  else impl_->params.remove(name.toUtf8());
  changed();
}

Opt<String> URLSearchParamsObject::get(const String& name) const {
  auto found = impl_->params.get(name.toUtf8());
  if (!found) return null;
  return fromAda(*found);
}

Array<String> URLSearchParamsObject::getAll(const String& name) const {
  Array<String> out;
  for (const auto& value : impl_->params.get_all(name.toUtf8())) out.push(fromAda(value));
  return out;
}

bool URLSearchParamsObject::has(const String& name, const Opt<String>& value) const {
  return value.has() ? impl_->params.has(name.toUtf8(), value.get().toUtf8()) : impl_->params.has(name.toUtf8());
}

void URLSearchParamsObject::set(const String& name, const String& value) {
  impl_->params.set(name.toUtf8(), value.toUtf8());
  changed();
}

void URLSearchParamsObject::sort() {
  impl_->params.sort();
  changed();
}

String URLSearchParamsObject::toString() const { return fromAda(impl_->params.to_string()); }

size_t URLSearchParamsObject::count() const { return impl_->params.size(); }

std::tuple<String, String> URLSearchParamsObject::entryAt(size_t i) const {
  const auto pair = impl_->params[i];
  return {fromAda(pair.first), fromAda(pair.second)};
}

void URLSearchParamsObject::changed() {
  if (auto url = url_.lock()) url->paramsChanged(impl_->params.to_string());
}

namespace {

/// The pairs' keys, values or entries, read by index while they last.
template <class T, class Get>
class ParamsIter final : public IterObject<T> {
 public:
  ParamsIter(URLSearchParams params, Get get) : params_(std::move(params)), get_(get) {}
  std::optional<T> next() override {
    if (!params_ || i_ >= params_->count()) {
      params_ = nullptr;
      return std::nullopt;
    }
    return get_(params_->entryAt(i_++));
  }

 private:
  URLSearchParams params_;
  Get get_;
  size_t i_ = 0;
};

template <class T, class Get>
Iter<T> paramsIter(URLSearchParams params, Get get) {
  return std::make_shared<ParamsIter<T, Get>>(std::move(params), get);
}

}  // namespace

Iter<std::tuple<String, String>> URLSearchParamsObject::entries() {
  auto self = std::static_pointer_cast<URLSearchParamsObject>(shared_from_this());
  return paramsIter<std::tuple<String, String>>(self, [](std::tuple<String, String> e) { return e; });
}

Iter<String> URLSearchParamsObject::keys() {
  auto self = std::static_pointer_cast<URLSearchParamsObject>(shared_from_this());
  return paramsIter<String>(self, [](std::tuple<String, String> e) { return std::get<0>(e); });
}

Iter<String> URLSearchParamsObject::values() {
  auto self = std::static_pointer_cast<URLSearchParamsObject>(shared_from_this());
  return paramsIter<String>(self, [](std::tuple<String, String> e) { return std::get<1>(e); });
}

}  // namespace lucent
