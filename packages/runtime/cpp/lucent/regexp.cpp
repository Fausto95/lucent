#include "regexp.h"

#include <cmath>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

#include "jserror.h"
#include "number.h"

extern "C" {
#include "../third_party/quickjs/libregexp.h"
}

// --- libregexp host callbacks --------------------------------------------------------------------

extern "C" int lre_check_stack_overflow(void*, size_t) { return 0; }
extern "C" int lre_check_timeout(void*) { return 0; }
extern "C" void* lre_realloc(void*, void* ptr, size_t size) {
  if (size == 0) {
    std::free(ptr);
    return nullptr;
  }
  return std::realloc(ptr, size);
}

namespace lucent {

struct CompiledRegExp {
  uint8_t* bytecode = nullptr;
  int flags = 0;
  int captureCount = 0;  // including the whole match
  int allocCount = 0;
  std::vector<std::string> groupNames;  // per capture; empty when unnamed
  ~CompiledRegExp() { std::free(bytecode); }
};

namespace {

int parseFlags(const String& flags) {
  int out = 0;
  for (size_t i = 0; i < flags.length(); i++) {
    int f = 0;
    switch (flags.unit(i)) {
      case 'd':
        f = LRE_FLAG_INDICES;
        break;
      case 'g':
        f = LRE_FLAG_GLOBAL;
        break;
      case 'i':
        f = LRE_FLAG_IGNORECASE;
        break;
      case 'm':
        f = LRE_FLAG_MULTILINE;
        break;
      case 's':
        f = LRE_FLAG_DOTALL;
        break;
      case 'u':
        f = LRE_FLAG_UNICODE;
        break;
      case 'v':
        f = LRE_FLAG_UNICODE_SETS;
        break;
      case 'y':
        f = LRE_FLAG_STICKY;
        break;
    }
    if (f == 0 || (out & f)) throwError(String::fromLatin1("SyntaxError"), String::fromUtf8("Invalid regular expression flags '" + flags.toUtf8() + "'"));
    out |= f;
  }
  if ((out & LRE_FLAG_UNICODE) && (out & LRE_FLAG_UNICODE_SETS)) throwError(String::fromLatin1("SyntaxError"), String::fromUtf8("Invalid regular expression flags '" + flags.toUtf8() + "'"));
  return out;
}

std::shared_ptr<CompiledRegExp> compile(const String& source, const String& flags) {
  static std::mutex mutex;
  static std::unordered_map<std::string, std::shared_ptr<CompiledRegExp>> cache;
  std::string pattern = source.toUtf8();
  std::string key = flags.toUtf8() + "/" + pattern;
  std::lock_guard<std::mutex> lock(mutex);
  if (auto it = cache.find(key); it != cache.end()) return it->second;
  int reFlags = parseFlags(flags);
  char error[128];
  int len = 0;
  uint8_t* bc = lre_compile(&len, error, sizeof error, pattern.c_str(), pattern.size(), reFlags, nullptr);
  if (!bc) throwError(String::fromLatin1("SyntaxError"), String::fromUtf8("Invalid regular expression: /" + pattern + "/" + flags.toUtf8() + ": " + error));
  auto re = std::make_shared<CompiledRegExp>();
  re->bytecode = bc;
  re->flags = lre_get_flags(bc);
  re->captureCount = lre_get_capture_count(bc);
  re->allocCount = lre_get_alloc_count(bc);
  re->groupNames.resize(static_cast<size_t>(re->captureCount));
  if (const char* names = lre_get_groupnames(bc)) {
    for (int i = 1; i < re->captureCount; i++) {
      re->groupNames[static_cast<size_t>(i)] = names;
      names += std::strlen(names) + LRE_GROUP_NAME_TRAILER_LEN;
    }
  }
  cache.emplace(std::move(key), re);
  return re;
}

double toLength(double v) {
  if (std::isnan(v) || v <= 0) return 0;
  return std::min(std::floor(v), 9007199254740991.0);
}

/// AdvanceStringIndex: past a whole code point in Unicode mode.
double advance(const String& s, double index, bool unicode) {
  if (!unicode || index + 1 >= static_cast<double>(s.length())) return index + 1;
  char16_t c = s.unit(static_cast<size_t>(index));
  char16_t d = s.unit(static_cast<size_t>(index) + 1);
  return (c >= 0xD800 && c <= 0xDBFF && d >= 0xDC00 && d <= 0xDFFF) ? index + 2 : index + 1;
}

String slice(const String& s, size_t from, size_t to) { return s.substring(static_cast<double>(from), static_cast<double>(to)); }

/// GetSubstitution: `$$`, `$&`, `` $` ``, `$'`, `$n`, `$nn`, `$<name>`.
String substitute(const String& matched, const String& str, size_t position, const Array<Opt<String>>& captures, const Opt<Dict<String>>& named, const String& tmpl) {
  std::u16string out;
  size_t m = captures.size();
  size_t n = tmpl.length();
  auto append = [&out](const String& x) {
    for (size_t k = 0; k < x.length(); k++) out.push_back(x.unit(k));
  };
  for (size_t i = 0; i < n; i++) {
    char16_t c = tmpl.unit(i);
    if (c != '$' || i + 1 >= n) {
      out.push_back(c);
      continue;
    }
    char16_t d = tmpl.unit(i + 1);
    if (d == '$') {
      out.push_back('$');
      i++;
    } else if (d == '&') {
      append(matched);
      i++;
    } else if (d == '`') {
      append(slice(str, 0, position));
      i++;
    } else if (d == '\'') {
      append(slice(str, std::min(position + matched.length(), str.length()), str.length()));
      i++;
    } else if (d >= '0' && d <= '9') {
      size_t one = static_cast<size_t>(d - '0');
      size_t two = (i + 2 < n && tmpl.unit(i + 2) >= '0' && tmpl.unit(i + 2) <= '9') ? one * 10 + static_cast<size_t>(tmpl.unit(i + 2) - '0') : 0;
      if (two >= 1 && two <= m) {
        if (auto v = captures.at(two - 1); v.has()) append(v.get());
        i += 2;
      } else if (one >= 1 && one <= m) {
        if (auto v = captures.at(one - 1); v.has()) append(v.get());
        i++;
      } else {
        out.push_back('$');
      }
    } else if (d == '<' && named.has()) {
      size_t close = i + 2;
      while (close < n && tmpl.unit(close) != '>') close++;
      if (close >= n) {
        out.push_back('$');
        continue;
      }
      String name = slice(tmpl, i + 2, close);
      if (auto v = named.get().get(name); v.has()) append(v.get());
      i = close;
    } else {
      out.push_back('$');
    }
  }
  return String::fromUtf16(out);
}

std::vector<RegExpMatch> collect(const String& s, const RegExp& re) {
  std::vector<RegExpMatch> out;
  bool global = re->global();
  if (global) re->lastIndex = 0;
  for (auto m = re->exec(s); m.has(); m = re->exec(s)) {
    out.push_back(m.get());
    if (!global) break;
    if (m.get()->items.at(0).get().empty()) re->lastIndex = advance(s, toLength(re->lastIndex), re->unicode() || re->unicodeSets());
  }
  return out;
}

String replaceMatches(const String& s, const std::vector<RegExpMatch>& matches, const std::function<String(const RegExpMatch&, size_t)>& replacement) {
  std::u16string out;
  size_t next = 0;
  for (const auto& m : matches) {
    String matched = m->items.at(0).get();
    size_t position = static_cast<size_t>(std::max(0.0, std::min(m->index.get(), static_cast<double>(s.length()))));
    String rep = replacement(m, position);
    if (position >= next) {
      for (size_t k = next; k < position; k++) out.push_back(s.unit(k));
      for (size_t k = 0; k < rep.length(); k++) out.push_back(rep.unit(k));
      next = position + matched.length();
    }
  }
  for (size_t k = next; k < s.length(); k++) out.push_back(s.unit(k));
  return String::fromUtf16(out);
}

Array<Opt<String>> capturesOf(const RegExpMatch& m) { return m->items.slice(1); }

class MatchAllIter final : public IterObject<RegExpMatch> {
 public:
  MatchAllIter(RegExp re, String s) : re_(std::move(re)), s_(std::move(s)) {}
  std::optional<RegExpMatch> next() override {
    if (done_) return std::nullopt;
    auto m = re_->exec(s_);
    if (!m.has()) {
      done_ = true;
      return std::nullopt;
    }
    if (m.get()->items.at(0).get().empty()) re_->lastIndex = advance(s_, toLength(re_->lastIndex), re_->unicode() || re_->unicodeSets());
    return m.get();
  }

 private:
  RegExp re_;
  String s_;
  bool done_ = false;
};

}  // namespace

RegExpObject::RegExpObject(const String& source, const String& flags) : source_(source), flags_(flags), re_(compile(source, flags)) {}

bool RegExpObject::global() const { return re_->flags & LRE_FLAG_GLOBAL; }
bool RegExpObject::ignoreCase() const { return re_->flags & LRE_FLAG_IGNORECASE; }
bool RegExpObject::multiline() const { return re_->flags & LRE_FLAG_MULTILINE; }
bool RegExpObject::dotAll() const { return re_->flags & LRE_FLAG_DOTALL; }
bool RegExpObject::unicode() const { return re_->flags & LRE_FLAG_UNICODE; }
bool RegExpObject::unicodeSets() const { return re_->flags & LRE_FLAG_UNICODE_SETS; }
bool RegExpObject::sticky() const { return re_->flags & LRE_FLAG_STICKY; }
bool RegExpObject::hasIndices() const { return re_->flags & LRE_FLAG_INDICES; }
int RegExpObject::groupCount() const { return re_->captureCount - 1; }

/// EscapeRegExpPattern: `/` and line terminators escaped, `(?:)` when empty.
String RegExpObject::source() const {
  if (source_.empty()) return String::fromLatin1("(?:)");
  std::u16string out;
  bool inClass = false;
  for (size_t i = 0; i < source_.length(); i++) {
    char16_t c = source_.unit(i);
    if (c == '\\' && i + 1 < source_.length()) {
      out.push_back(c);
      out.push_back(source_.unit(++i));
      continue;
    }
    if (c == '[') inClass = true;
    else if (c == ']') inClass = false;
    if (c == '/' && !inClass) out.append(u"\\/");
    else if (c == '\n') out.append(u"\\n");
    else if (c == '\r') out.append(u"\\r");
    else if (c == 0x2028) out.append(u"\\u2028");
    else if (c == 0x2029) out.append(u"\\u2029");
    else out.push_back(c);
  }
  return String::fromUtf16(out);
}

/// Flags in the canonical order JavaScript reports them.
String RegExpObject::canonicalFlags() const {
  std::string out;
  if (hasIndices()) out += 'd';
  if (global()) out += 'g';
  if (ignoreCase()) out += 'i';
  if (multiline()) out += 'm';
  if (dotAll()) out += 's';
  if (unicode()) out += 'u';
  if (unicodeSets()) out += 'v';
  if (sticky()) out += 'y';
  return String::fromLatin1(out);
}

String RegExpObject::toString() const { return String::fromLatin1("/") + source() + String::fromLatin1("/") + canonicalFlags(); }

Opt<RegExpMatch> RegExpObject::exec(const String& s) {
  bool gy = global() || sticky();
  double li = gy ? toLength(lastIndex) : 0;
  size_t len = s.length();
  if (li > static_cast<double>(len)) {
    if (gy) lastIndex = 0;
    return null;
  }
  static const uint8_t empty[2] = {0, 0};
  const uint8_t* buf;
  int type;
  if (s.isOneByte()) {
    buf = len ? reinterpret_cast<const uint8_t*>(s.latin1().data()) : empty;
    type = 0;
  } else {
    buf = reinterpret_cast<const uint8_t*>(s.utf16().data());
    type = 1;
  }
  std::vector<uint8_t*> capture(static_cast<size_t>(std::max(re_->allocCount, re_->captureCount * 2)));
  int r = lre_exec(capture.data(), re_->bytecode, buf, static_cast<int>(li), static_cast<int>(len), type, nullptr);
  if (r < 0) throwRangeError("Regular expression matching ran out of memory");
  if (r == 0) {
    if (gy) lastIndex = 0;
    return null;
  }
  auto offset = [&](const uint8_t* p) { return static_cast<size_t>(p - buf) >> type; };
  auto m = std::make_shared<RegExpMatchObject>();
  for (int i = 0; i < re_->captureCount; i++) {
    const uint8_t* a = capture[static_cast<size_t>(2 * i)];
    const uint8_t* b = capture[static_cast<size_t>(2 * i + 1)];
    if (a && b) m->items.push(Opt<String>(slice(s, offset(a), offset(b))));
    else m->items.push(Opt<String>(undefined));
    const std::string& name = re_->groupNames[static_cast<size_t>(i)];
    if (i > 0 && !name.empty()) {
      if (!m->groups.has()) m->groups = Dict<String>();
      // Duplicate names in alternatives: the participating group wins.
      if (a && b) m->groups.get().set(String::fromUtf8(name), slice(s, offset(a), offset(b)));
    }
  }
  if (re_->groupNames.size() > 1 && !m->groups.has()) {
    for (const auto& n : re_->groupNames) {
      if (!n.empty()) {
        m->groups = Dict<String>();
        break;
      }
    }
  }
  m->index = static_cast<double>(offset(capture[0]));
  m->input = s;
  if (gy) lastIndex = static_cast<double>(offset(capture[1]));
  return m;
}

RegExp makeRegExp(const String& source, Opt<String> flags) {
  return std::make_shared<RegExpObject>(source, flags.has() ? flags.get() : String());
}

RegExp makeRegExp(const RegExp& re, Opt<String> flags) {
  return std::make_shared<RegExpObject>(re->source(), flags.has() ? flags.get() : re->flags());
}

Opt<RegExpMatch> stringMatch(const String& s, const RegExp& re) {
  if (!re->global()) return re->exec(s);
  auto matches = collect(s, re);
  if (matches.empty()) return null;
  auto out = std::make_shared<RegExpMatchObject>();
  for (const auto& m : matches) out->items.push(m->items.at(0));
  return RegExpMatch(out);
}

Iter<RegExpMatch> stringMatchAll(const String& s, const RegExp& re) {
  if (!re->global()) throwTypeError("String.prototype.matchAll needs a global RegExp (the g flag)");
  auto copy = makeRegExp(re);
  copy->lastIndex = toLength(re->lastIndex);
  return std::make_shared<MatchAllIter>(copy, s);
}

double stringSearch(const String& s, const RegExp& re) {
  double previous = re->lastIndex;
  re->lastIndex = 0;
  auto m = re->exec(s);
  re->lastIndex = previous;
  return m.has() ? m.get()->index.get() : -1;
}

String stringReplace(const String& s, const RegExp& re, const String& replacement) {
  auto matches = collect(s, re);
  return replaceMatches(s, matches, [&](const RegExpMatch& m, size_t position) { return substitute(m->items.at(0).get(), s, position, capturesOf(m), m->groups, replacement); });
}

String stringReplace(const String& s, const RegExp& re, const Replacer& replacer) {
  auto matches = collect(s, re);
  return replaceMatches(s, matches, [&](const RegExpMatch& m, size_t position) {
    return replacer(ReplaceCall{m->items.at(0).get(), capturesOf(m), static_cast<double>(position), s, m->groups});
  });
}

String stringReplaceAll(const String& s, const RegExp& re, const String& replacement) {
  if (!re->global()) throwTypeError("String.prototype.replaceAll needs a global RegExp (the g flag)");
  return stringReplace(s, re, replacement);
}

String stringReplaceAll(const String& s, const RegExp& re, const Replacer& replacer) {
  if (!re->global()) throwTypeError("String.prototype.replaceAll needs a global RegExp (the g flag)");
  return stringReplace(s, re, replacer);
}

Array<String> stringSplit(const String& s, const RegExp& re, Opt<double> limit) {
  String flags = re->flags();
  bool unicode = re->unicode() || re->unicodeSets();
  bool hasY = false;
  for (size_t i = 0; i < flags.length(); i++) hasY = hasY || flags.unit(i) == 'y';
  RegExp splitter = makeRegExp(re->source(), hasY ? flags : flags + String::fromLatin1("y"));
  Array<String> out;
  double lim = limit.has() ? static_cast<double>(toUint32(limit.get())) : 4294967295.0;
  if (lim == 0) return out;
  size_t size = s.length();
  if (size == 0) {
    if (!splitter->exec(s).has()) out.push(s);
    return out;
  }
  size_t p = 0, q = 0;
  while (q < size) {
    splitter->lastIndex = static_cast<double>(q);
    auto z = splitter->exec(s);
    if (!z.has()) {
      q = static_cast<size_t>(advance(s, static_cast<double>(q), unicode));
      continue;
    }
    size_t e = std::min(static_cast<size_t>(toLength(splitter->lastIndex)), size);
    if (e == p) {
      q = static_cast<size_t>(advance(s, static_cast<double>(q), unicode));
      continue;
    }
    out.push(slice(s, p, q));
    if (static_cast<double>(out.size()) == lim) return out;
    p = e;
    const auto& items = z.get()->items;
    for (size_t i = 1; i < items.size(); i++) {
      auto v = items.at(i);
      out.push(v.has() ? v.get() : String());
      if (static_cast<double>(out.size()) == lim) return out;
    }
    q = p;
  }
  out.push(slice(s, p, size));
  return out;
}

String captureOrThrow(const Opt<String>& capture, int group) {
  if (!capture.has()) {
    throwTypeError(("capture group " + std::to_string(group) + " did not participate in the match; declare the callback parameter as string | undefined").c_str());
  }
  return capture.get();
}

}  // namespace lucent
