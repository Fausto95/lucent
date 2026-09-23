// Lucent runtime — RegExp.
//
// Patterns compile once (cached by source and flags) with QuickJS's
// libregexp (third_party/quickjs), which implements ECMAScript regular
// expressions over Latin-1 and UTF-16 buffers, so matching needs no
// conversion. The algorithms around it (lastIndex, match, replace, split…)
// follow the ECMAScript specification.
#pragma once

#include <functional>
#include <memory>

#include "array.h"
#include "core.h"
#include "generator.h"
#include "jsstring.h"
#include "map.h"

namespace lucent {

struct CompiledRegExp;

/// The result of exec / match: the matched strings (undefined for groups
/// that did not participate), and for exec-style results index, input and
/// named groups.
struct RegExpMatchObject : Object {
  Array<Opt<String>> items;
  Opt<double> index;
  Opt<String> input;
  /// Named groups that participated (JavaScript's `groups`), or undefined.
  Opt<Dict<String>> groups;
};
using RegExpMatch = Ref<RegExpMatchObject>;

class RegExpObject : public Object {
 public:
  /// Throws SyntaxError for an invalid pattern or flags.
  RegExpObject(const String& source, const String& flags);

  String source() const;
  const String& flags() const { return flags_; }
  bool global() const;
  bool ignoreCase() const;
  bool multiline() const;
  bool dotAll() const;
  bool unicode() const;
  bool unicodeSets() const;
  bool sticky() const;
  bool hasIndices() const;
  double lastIndex = 0;

  Opt<RegExpMatch> exec(const String& s);
  bool test(const String& s) { return exec(s).has(); }
  String toString() const;
  /// `re.flags`: the flags in canonical order ("dgimsuvy").
  String canonicalFlags() const;

  /// Number of capturing groups, not counting the whole match.
  int groupCount() const;

  // For the String methods below.
  const std::shared_ptr<CompiledRegExp>& compiled() const { return re_; }

 private:
  String source_;
  String flags_;
  std::shared_ptr<CompiledRegExp> re_;
};
using RegExp = Ref<RegExpObject>;

RegExp makeRegExp(const String& source, Opt<String> flags = undefined);
/// `new RegExp(re, flags?)`: a copy with the same source.
RegExp makeRegExp(const RegExp& re, Opt<String> flags = undefined);

/// The arguments JavaScript passes a replacement function.
struct ReplaceCall {
  String match;
  Array<Opt<String>> captures;
  double position = 0;
  String input;
  Opt<Dict<String>> groups;
};
using Replacer = std::function<String(const ReplaceCall&)>;

Opt<RegExpMatch> stringMatch(const String& s, const RegExp& re);
Iter<RegExpMatch> stringMatchAll(const String& s, const RegExp& re);
double stringSearch(const String& s, const RegExp& re);
String stringReplace(const String& s, const RegExp& re, const String& replacement);
String stringReplace(const String& s, const RegExp& re, const Replacer& replacer);
/// replaceAll requires the g flag (TypeError otherwise).
String stringReplaceAll(const String& s, const RegExp& re, const String& replacement);
String stringReplaceAll(const String& s, const RegExp& re, const Replacer& replacer);
Array<String> stringSplit(const String& s, const RegExp& re, Opt<double> limit = undefined);

/// A capture passed to a replacement callback parameter typed `string`.
String captureOrThrow(const Opt<String>& capture, int group);

/// `match[i]`: undefined past the end or for a group that did not participate.
inline Opt<String> matchItem(const RegExpMatch& m, double i) {
  auto v = m->items.get(i);
  return v.has() ? v.get() : Opt<String>(undefined);
}

inline String toJsString(const RegExp& re) { return re->toString(); }
inline String toJsString(const RegExpMatch& m) { return m->items.join(); }

}  // namespace lucent
