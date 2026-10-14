// Lucent runtime — URL and URLSearchParams, by WHATWG's URL standard, on
// the vendored Ada parser (third_party/ada), which only url/url.cpp includes.
// A URL's searchParams is made once and stays linked to it: a change to
// either shows in the other, as the standard's update steps say.
#pragma once

#include <cstddef>
#include <memory>
#include <tuple>
#include <utility>

#include "array.h"
#include "core.h"
#include "function.h"
#include "generator.h"
#include "jsstring.h"
#include "map.h"

namespace lucent {

class URLObject;
class URLSearchParamsObject;
using URL = Ref<URLObject>;
using URLSearchParams = Ref<URLSearchParamsObject>;

class URLObject : public Object {
 public:
  URLObject();
  ~URLObject() override;

  /// `new URL(input, base)`: a TypeError ("Invalid URL") where it doesn't parse.
  static URL make(const String& input, const Opt<String>& base);
  /// `URL.parse(input, base)`: null where it doesn't parse.
  static Opt<URL> parse(const String& input, const Opt<String>& base);
  /// `URL.canParse(input, base)`.
  static bool canParse(const String& input, const Opt<String>& base);

  String href() const;
  /// A TypeError ("Invalid URL") where `value` doesn't parse.
  void setHref(const String& value);
  String origin() const;
  String protocol() const;
  void setProtocol(const String& value);
  String username() const;
  void setUsername(const String& value);
  String password() const;
  void setPassword(const String& value);
  String host() const;
  void setHost(const String& value);
  String hostname() const;
  void setHostname(const String& value);
  String port() const;
  void setPort(const String& value);
  String pathname() const;
  void setPathname(const String& value);
  String search() const;
  void setSearch(const String& value);
  String hash() const;
  void setHash(const String& value);
  /// The same object each time, linked to this URL.
  URLSearchParams searchParams();
  String toString() const { return href(); }
  String toJSON() const { return href(); }

 private:
  friend class URLSearchParamsObject;
  struct Impl;
  std::unique_ptr<Impl> impl_;
  URLSearchParams params_;

  /// The query changed: what searchParams holds is parsed from it again.
  void queryChanged();
  /// searchParams changed: its serialization is the query.
  void paramsChanged(const std::string& serialized);
};

class URLSearchParamsObject : public Object {
 public:
  URLSearchParamsObject();
  ~URLSearchParamsObject() override;

  /// `new URLSearchParams(text)`: a leading `?` is left out.
  static URLSearchParams fromString(const String& init);
  /// `new URLSearchParams(pairs)`: a TypeError where a pair isn't two strings.
  static URLSearchParams fromPairs(const Array<Array<String>>& pairs);
  static URLSearchParams fromTuples(const Array<std::tuple<String, String>>& pairs);
  /// `new URLSearchParams(record)`, in the record's key order.
  static URLSearchParams fromRecord(const Dict<String>& record);
  /// `new URLSearchParams(other)`: a copy, linked to no URL.
  static URLSearchParams copy(const URLSearchParams& other);

  double size() const { return static_cast<double>(count()); }
  void append(const String& name, const String& value);
  /// `delete(name, value)`: every pair of `name`, or of `name` and `value`.
  void remove(const String& name, const Opt<String>& value);
  /// The first value of `name`; null when there is none.
  Opt<String> get(const String& name) const;
  Array<String> getAll(const String& name) const;
  bool has(const String& name, const Opt<String>& value) const;
  void set(const String& name, const String& value);
  /// By name, in UTF-16 code unit order; pairs of one name keep their order.
  void sort();
  String toString() const;

  /// The pairs, read by index as JavaScript's iterators and forEach do: a
  /// pair added while they run is visited.
  size_t count() const;
  std::tuple<String, String> entryAt(size_t i) const;

  /// `forEach((value, key, parent) => …)`.
  template <class F>
  void forEach(F&& f) {
    URLSearchParams self = std::static_pointer_cast<URLSearchParamsObject>(shared_from_this());
    for (size_t i = 0; i < count(); i++) {
      auto [key, value] = entryAt(i);
      invokeCallback(f, value, key, self);
    }
  }
  Iter<std::tuple<String, String>> entries();
  Iter<String> keys();
  Iter<String> values();

 private:
  friend class URLObject;
  struct Impl;
  std::unique_ptr<Impl> impl_;
  /// The URL whose query this is, if any: it holds this object, which doesn't keep it alive.
  std::weak_ptr<URLObject> url_;

  /// The standard's update steps: the linked URL's query becomes this object's serialization.
  void changed();
};

/// `for (const [key, value] of params)`.
inline Iter<std::tuple<String, String>> iterOf(const URLSearchParams& params) { return params->entries(); }

inline String toJsString(const URL& url) { return url->href(); }
inline String toJsString(const URLSearchParams& params) { return params->toString(); }

}  // namespace lucent
