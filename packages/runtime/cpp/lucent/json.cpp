#include "json_parse.h"

#include "jserror.h"
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
          v.members.emplace_back(std::move(key), value(depth + 1));
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
    if (it->first == key) return &it->second;
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

}  // namespace lucent
