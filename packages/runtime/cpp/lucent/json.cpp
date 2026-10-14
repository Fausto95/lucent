#include "json_parse.h"

#include <cmath>
#include <vector>

#include "jserror.h"
#include "json.h"
#include "number.h"

namespace lucent {

namespace {

constexpr int kMaxDepth = 1000;

class Parser {
 public:
  explicit Parser(const String& s) : s_(s), n_(s.length()) {}

  JsonValue parse() {
    ws();
    JsonValue v = value(0);
    ws();
    if (i_ < n_) unexpected();
    return v;
  }

 private:
  char16_t at(size_t i) const { return s_.unit(i); }

  [[noreturn]] void fail(const std::string& what) {
    throwError(String::fromLatin1("SyntaxError"), String::fromUtf8("JSON Parse error: " + what));
  }
  [[noreturn]] void unexpected() {
    if (i_ >= n_) fail("Unexpected end of input");
    char16_t c = at(i_);
    std::string tok = c < 0x80 ? std::string(1, static_cast<char>(c)) : "\\u" + std::to_string(c);
    fail("Unexpected token: " + tok);
  }

  void ws() {
    while (i_ < n_) {
      char16_t c = at(i_);
      if (c != ' ' && c != '\t' && c != '\n' && c != '\r') break;
      i_++;
    }
  }
  bool eat(char16_t c) {
    if (i_ < n_ && at(i_) == c) {
      i_++;
      return true;
    }
    return false;
  }
  void literal(const char* word) {
    for (const char* w = word; *w; w++) {
      if (!eat(static_cast<char16_t>(*w))) unexpected();
    }
  }

  JsonValue value(int depth) {
    if (depth > kMaxDepth) throwRangeError("JSON nesting is too deep");
    if (i_ >= n_) unexpected();
    JsonValue v;
    switch (at(i_)) {
      case '{': {
        i_++;
        v.kind = JsonValue::Kind::Object;
        ws();
        if (eat('}')) return v;
        for (;;) {
          ws();
          if (i_ >= n_ || at(i_) != '"') unexpected();
          String key = string();
          ws();
          if (!eat(':')) unexpected();
          ws();
          v.members.push_back(JsonMember{std::move(key), value(depth + 1)});
          ws();
          if (eat('}')) return v;
          if (!eat(',')) unexpected();
        }
      }
      case '[': {
        i_++;
        v.kind = JsonValue::Kind::Array;
        ws();
        if (eat(']')) return v;
        for (;;) {
          ws();
          v.items.push_back(value(depth + 1));
          ws();
          if (eat(']')) return v;
          if (!eat(',')) unexpected();
        }
      }
      case '"':
        v.kind = JsonValue::Kind::String;
        v.string = string();
        return v;
      case 't':
        literal("true");
        v.kind = JsonValue::Kind::Bool;
        v.boolean = true;
        return v;
      case 'f':
        literal("false");
        v.kind = JsonValue::Kind::Bool;
        return v;
      case 'n':
        literal("null");
        return v;
      default:
        v.kind = JsonValue::Kind::Number;
        v.number = number();
        return v;
    }
  }

  bool digit() const { return i_ < n_ && at(i_) >= '0' && at(i_) <= '9'; }

  double number() {
    size_t start = i_;
    eat('-');
    if (eat('0')) {
      // No leading zeros.
    } else if (digit()) {
      while (digit()) i_++;
    } else {
      unexpected();
    }
    if (eat('.')) {
      if (!digit()) unexpected();
      while (digit()) i_++;
    }
    if (eat('e') || eat('E')) {
      if (!eat('+')) eat('-');
      if (!digit()) unexpected();
      while (digit()) i_++;
    }
    return stringToNumber(s_.substring(static_cast<double>(start), static_cast<double>(i_)));
  }

  int hex(char16_t c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
  }

  String string() {
    i_++;  // opening quote
    std::u16string out;
    for (;;) {
      if (i_ >= n_) fail("Unterminated string");
      char16_t c = at(i_++);
      if (c == '"') break;
      if (c < 0x20) {
        i_--;
        unexpected();
      }
      if (c != '\\') {
        out.push_back(c);
        continue;
      }
      if (i_ >= n_) fail("Unterminated string");
      char16_t e = at(i_++);
      switch (e) {
        case '"':
        case '\\':
        case '/':
          out.push_back(e);
          break;
        case 'b':
          out.push_back(u'\b');
          break;
        case 'f':
          out.push_back(u'\f');
          break;
        case 'n':
          out.push_back(u'\n');
          break;
        case 'r':
          out.push_back(u'\r');
          break;
        case 't':
          out.push_back(u'\t');
          break;
        case 'u': {
          int code = 0;
          for (int k = 0; k < 4; k++) {
            int h = i_ < n_ ? hex(at(i_)) : -1;
            if (h < 0) fail("Invalid unicode escape");
            code = code * 16 + h;
            i_++;
          }
          out.push_back(static_cast<char16_t>(code));
          break;
        }
        default:
          i_ -= 2;
          fail("Invalid escape sequence");
      }
    }
    return String::fromUtf16(out);
  }

  const String& s_;
  size_t n_;
  size_t i_ = 0;
};

}  // namespace

const JsonValue* JsonValue::find(const String& key) const {
  for (auto it = members.rbegin(); it != members.rend(); ++it) {
    if (it->key == key) return &it->value;
  }
  return nullptr;
}

const char* JsonValue::describe() const {
  switch (kind) {
    case Kind::Null:
      return "null";
    case Kind::Bool:
      return "a boolean";
    case Kind::Number:
      return "a number";
    case Kind::String:
      return "a string";
    case Kind::Array:
      return "an array";
    case Kind::Object:
      return "an object";
  }
  return "a value";
}

JsonValue jsonParseTree(const String& text) { return Parser(text).parse(); }

void jsonShapeError(const std::string& path, const char* expected, const char* got) {
  std::string where = path.empty() ? "" : " at " + path;
  throwTypeError(("JSON.parse: expected " + std::string(expected) + where + ", got " + got).c_str());
}

namespace json {

String gapOf(double space) {
  if (std::isnan(space) || space < 1) return String();
  int n = space >= 10 ? 10 : static_cast<int>(space);
  return String::fromLatin1(std::string(static_cast<size_t>(n), ' '));
}

String gapOf(const String& space) {
  if (space.length() <= 10) return space;
  std::u16string units;
  for (size_t i = 0; i < 10; i++) units.push_back(space.unit(i));
  return String::fromUtf16(units);
}

Opt<Array<String>> keysOf(const Array<String>& keys) {
  Array<String> once;
  for (const auto& k : keys.items()) {
    bool seen = false;
    for (const auto& o : once.items()) seen = seen || o == k;
    if (!seen) once.push(k);
  }
  return once;
}

namespace {

/// Re-writes compact JSON, as JSON.stringify's SerializeJSONObject and
/// SerializeJSONArray do with a property list and a gap.
class Formatter {
 public:
  Formatter(const std::u16string& s, const Opt<Array<String>>& keys, const String& gap) : s_(s) {
    for (size_t i = 0; i < gap.length(); i++) gap_.push_back(gap.unit(i));
    if (keys.has()) {
      filtered_ = true;
      // Each key as the writer quotes it, to compare with the text's.
      for (const auto& k : keys.get().items()) {
        JsonWriter w;
        w.quote(k);
        keys_.push_back(std::move(w.out));
      }
    }
  }

  std::u16string value(const std::u16string& indent) {
    switch (s_[i_]) {
      case u'{':
        return object(indent);
      case u'[':
        return array(indent);
      case u'"':
        return string();
      default: {
        size_t start = i_;
        while (i_ < s_.size() && s_[i_] != u',' && s_[i_] != u']' && s_[i_] != u'}') i_++;
        return s_.substr(start, i_ - start);
      }
    }
  }

 private:
  std::u16string string() {
    size_t start = i_++;
    while (s_[i_] != u'"') i_ += s_[i_] == u'\\' ? 2 : 1;
    i_++;
    return s_.substr(start, i_ - start);
  }

  std::u16string object(const std::u16string& stepback) {
    std::u16string indent = stepback + gap_;
    std::vector<std::pair<std::u16string, std::u16string>> members;
    i_++;
    while (s_[i_] != u'}') {
      std::u16string key = string();
      i_++;  // ':'
      std::u16string v = value(indent);
      members.emplace_back(std::move(key), std::move(v));
      if (s_[i_] == u',') i_++;
    }
    i_++;

    std::vector<std::u16string> parts;
    auto member = [&](const std::pair<std::u16string, std::u16string>& m) {
      parts.push_back(m.first + (gap_.empty() ? u":" : u": ") + m.second);
    };
    if (!filtered_)
      for (const auto& m : members) member(m);
    else
      // The list's order, each key the object has.
      for (const auto& k : keys_)
        for (const auto& m : members)
          if (m.first == k) {
            member(m);
            break;
          }
    return wrap(u'{', u'}', parts, stepback, indent);
  }

  std::u16string array(const std::u16string& stepback) {
    std::u16string indent = stepback + gap_;
    std::vector<std::u16string> parts;
    i_++;
    while (s_[i_] != u']') {
      parts.push_back(value(indent));
      if (s_[i_] == u',') i_++;
    }
    i_++;
    return wrap(u'[', u']', parts, stepback, indent);
  }

  std::u16string wrap(char16_t open, char16_t close, const std::vector<std::u16string>& parts,
                      const std::u16string& stepback, const std::u16string& indent) {
    std::u16string out(1, open);
    if (parts.empty()) return out + close;
    for (size_t k = 0; k < parts.size(); k++) {
      if (k) out.push_back(u',');
      if (!gap_.empty()) out += u"\n" + indent;
      out += parts[k];
    }
    if (!gap_.empty()) out += u"\n" + stepback;
    out.push_back(close);
    return out;
  }

  const std::u16string& s_;
  size_t i_ = 0;
  std::u16string gap_;
  bool filtered_ = false;
  std::vector<std::u16string> keys_;
};

}  // namespace

std::u16string format(const std::u16string& compact, const Opt<Array<String>>& keys, const String& gap) {
  return Formatter(compact, keys, gap).value(u"");
}

}  // namespace json

}  // namespace lucent
