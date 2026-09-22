// Hand-written module in the shape the compiler generates. It pins down the
// binding API before the compiler exists, and keeps testing it afterwards.
#include "lucent/jsi/convert.h"
#include "lucent/jsi/host.h"

using namespace lucent;
namespace jsi = facebook::jsi;
using js::Convert;
using js::Host;
using js::Path;

namespace m_manual {

struct Point : Object {
  double x = 0;
  double y = 0;
};

struct Counter : Object {
  double count = 0;
  double increment(double by) {
    count += by;
    return count;
  }
};

double hash(String input, double seed) {
  int32_t h = toInt32(seed);
  for (size_t i = 0; i < input.length(); i++) {
    h = static_cast<int32_t>(math::imul(static_cast<double>(h ^ input.unit(i)), 0x5bd1e995));
    h ^= static_cast<int32_t>(static_cast<uint32_t>(h) >> 15);
  }
  return static_cast<double>(static_cast<uint32_t>(h));
}

Promise<Array<double>> hashMany(Array<String> inputs) {
  co_await delay(1);
  co_return inputs.map<double>([](const String& s) { return hash(s, 0); });
}

Ref<Point> midpoint(Ref<Point> a, Ref<Point> b) {
  auto p = std::make_shared<Point>();
  p->x = (a->x + b->x) / 2;
  p->y = (a->y + b->y) / 2;
  return p;
}

double divide(double a, double b) {
  if (b == 0) {
    Error e = makeError(String::fromLatin1("Cannot divide by zero"));
    e->code = String::fromLatin1("DIVIDE_BY_ZERO");
    throwError(e);
  }
  return a / b;
}

void each(Array<double> xs, Fn<void(double)> f) {
  xs.forEach([&](double v) { f(v); });
}

double sumMapped(Array<double> xs, Fn<double(double)> f) {
  return xs.map<double>([&](double v) { return f(v); }).reduce([](double a, double b) { return a + b; }, 0.0);
}

Promise<double> progress(double steps, Fn<void(double)> onStep) {
  for (double i = 1; i <= steps; i++) {
    co_await delay(1);
    onStep(i);
  }
  co_return steps;
}

Promise<String> askJs(Fn<Promise<String>(String)> ask) {
  String answer = co_await ask(String::fromLatin1("name?"));
  co_return String::fromLatin1("got ") + answer;
}

Union<double, String> parse(String s) {
  double n = stringToNumber(s);
  if (std::isnan(n)) return s;
  return n;
}

}  // namespace m_manual

namespace lucent::js {
template <>
struct Convert<Ref<m_manual::Point>> {
  static Ref<m_manual::Point> fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
    if (!v.isObject()) throwBoundaryError(rt, p, "an object", v);
    jsi::Object o = v.getObject(rt);
    auto out = std::make_shared<m_manual::Point>();
    out->x = Convert<double>::fromJs(rt, o.getProperty(rt, "x"), p.field("x"));
    out->y = Convert<double>::fromJs(rt, o.getProperty(rt, "y"), p.field("y"));
    return out;
  }
  static jsi::Value toJs(jsi::Runtime& rt, Host& h, const Ref<m_manual::Point>& v) {
    jsi::Object o(rt);
    o.setProperty(rt, "x", Convert<double>::toJs(rt, h, v->x));
    o.setProperty(rt, "y", Convert<double>::toJs(rt, h, v->y));
    return jsi::Value(rt, o);
  }
};

template <>
struct Convert<Union<double, String>> {
  static Union<double, String> fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
    if (v.isNumber()) return v.getNumber();
    if (v.isString()) return Convert<String>::fromJs(rt, v, p);
    throwBoundaryError(rt, p, "a number or a string", v);
  }
  static jsi::Value toJs(jsi::Runtime& rt, Host& h, const Union<double, String>& v) {
    return std::visit([&](const auto& x) { return Convert<std::decay_t<decltype(x)>>::toJs(rt, h, x); }, v);
  }
};

void counterProto(jsi::Runtime& rt, Host& host, jsi::Object& proto);

template <>
struct Convert<Ref<m_manual::Counter>> {
  static Ref<m_manual::Counter> fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
    if (v.isObject()) {
      jsi::Object o = v.getObject(rt);
      if (o.hasNativeState(rt)) {
        if (auto s = std::dynamic_pointer_cast<InstanceStateBase>(o.getNativeState(rt))) {
          if (auto c = std::dynamic_pointer_cast<m_manual::Counter>(s->object)) return c;
        }
      }
    }
    throwBoundaryError(rt, p, "a Counter", v);
  }
  static jsi::Value toJs(jsi::Runtime& rt, Host& h, const Ref<m_manual::Counter>& v) {
    return h.wrap(rt, v, "manual.Counter", counterProto);
  }
};

void counterProto(jsi::Runtime& rt, Host& host, jsi::Object& proto) {
  proto.setProperty(rt, "increment",
                    jsi::Function::createFromHostFunction(rt, jsi::PropNameID::forAscii(rt, "increment"), 1,
                                                          [](jsi::Runtime& rt, const jsi::Value& self, const jsi::Value* args, size_t n) {
                                                            Host& host = Host::get(rt);
                                                            return callSync(rt, host, [&] {
                                                              auto c = Convert<Ref<m_manual::Counter>>::fromJs(rt, self, Path{"Counter.increment", "this"});
                                                              double by = Convert<double>::fromJs(rt, arg(args, n, 0), Path{"Counter.increment", "argument 'by'"});
                                                              return Convert<double>::toJs(rt, host, c->increment(by));
                                                            });
                                                          }));
  defineAccessor(rt, proto, "count",
                 [](jsi::Runtime& rt, const jsi::Value& self, const jsi::Value*, size_t) {
                   Host& host = Host::get(rt);
                   return callSync(rt, host, [&] {
                     auto c = Convert<Ref<m_manual::Counter>>::fromJs(rt, self, Path{"Counter.count", "this"});
                     return Convert<double>::toJs(rt, host, c->count);
                   });
                 },
                 nullptr);
}
}  // namespace lucent::js

namespace {
using namespace lucent::js;

void install(jsi::Runtime& rt, Host& host, jsi::Object& exports) {
  defineFunction(rt, exports, "hash", 2, [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t n) {
    Host& host = Host::get(rt);
    return callSync(rt, host, [&] {
      String input = Convert<String>::fromJs(rt, arg(args, n, 0), Path{"hash", "argument 'input'"});
      double seed = arg(args, n, 1).isUndefined() ? 0.0 : Convert<double>::fromJs(rt, args[1], Path{"hash", "argument 'seed'"});
      return Convert<double>::toJs(rt, host, m_manual::hash(input, seed));
    });
  });
  defineFunction(rt, exports, "hashMany", 1, [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t n) {
    Host& host = Host::get(rt);
    LucentScope scope;
    auto inputs = Convert<Array<String>>::fromJs(rt, arg(args, n, 0), Path{"hashMany", "argument 'inputs'"});
    return callAsync<Array<double>>(rt, host, [inputs] { return m_manual::hashMany(inputs); });
  });
  defineFunction(rt, exports, "midpoint", 2, [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t n) {
    Host& host = Host::get(rt);
    return callSync(rt, host, [&] {
      auto a = Convert<Ref<m_manual::Point>>::fromJs(rt, arg(args, n, 0), Path{"midpoint", "argument 'a'"});
      auto b = Convert<Ref<m_manual::Point>>::fromJs(rt, arg(args, n, 1), Path{"midpoint", "argument 'b'"});
      return Convert<Ref<m_manual::Point>>::toJs(rt, host, m_manual::midpoint(a, b));
    });
  });
  defineFunction(rt, exports, "divide", 2, [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t n) {
    Host& host = Host::get(rt);
    return callSync(rt, host, [&] {
      double a = Convert<double>::fromJs(rt, arg(args, n, 0), Path{"divide", "argument 'a'"});
      double b = Convert<double>::fromJs(rt, arg(args, n, 1), Path{"divide", "argument 'b'"});
      return Convert<double>::toJs(rt, host, m_manual::divide(a, b));
    });
  });
  defineFunction(rt, exports, "each", 2, [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t n) {
    Host& host = Host::get(rt);
    return callSync(rt, host, [&] {
      auto xs = Convert<Array<double>>::fromJs(rt, arg(args, n, 0), Path{"each", "argument 'xs'"});
      auto f = Convert<Fn<void(double)>>::fromJs(rt, arg(args, n, 1), Path{"each", "argument 'f'"});
      m_manual::each(xs, f);
      return jsi::Value::undefined();
    });
  });
  defineFunction(rt, exports, "sumMapped", 2, [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t n) {
    Host& host = Host::get(rt);
    return callSync(rt, host, [&] {
      auto xs = Convert<Array<double>>::fromJs(rt, arg(args, n, 0), Path{"sumMapped", "argument 'xs'"});
      auto f = Convert<Fn<double(double)>>::fromJs(rt, arg(args, n, 1), Path{"sumMapped", "argument 'f'"});
      return Convert<double>::toJs(rt, host, m_manual::sumMapped(xs, f));
    });
  });
  defineFunction(rt, exports, "progress", 2, [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t n) {
    Host& host = Host::get(rt);
    LucentScope scope;
    double steps = Convert<double>::fromJs(rt, arg(args, n, 0), Path{"progress", "argument 'steps'"});
    auto f = Convert<Fn<void(double)>>::fromJs(rt, arg(args, n, 1), Path{"progress", "argument 'onStep'"});
    return callAsync<double>(rt, host, [steps, f] { return m_manual::progress(steps, f); });
  });
  defineFunction(rt, exports, "askJs", 1, [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t n) {
    Host& host = Host::get(rt);
    LucentScope scope;
    auto f = Convert<Fn<Promise<String>(String)>>::fromJs(rt, arg(args, n, 0), Path{"askJs", "argument 'ask'"});
    return callAsync<String>(rt, host, [f] { return m_manual::askJs(f); });
  });
  defineFunction(rt, exports, "parse", 1, [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t n) {
    Host& host = Host::get(rt);
    return callSync(rt, host, [&] {
      String s = Convert<String>::fromJs(rt, arg(args, n, 0), Path{"parse", "argument 's'"});
      return Convert<Union<double, String>>::toJs(rt, host, m_manual::parse(s));
    });
  });
  defineClass(rt, host, exports, "Counter", "manual.Counter", counterProto, 1,
              [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t n) {
                Host& host = Host::get(rt);
                return callSync(rt, host, [&] {
                  auto c = std::make_shared<m_manual::Counter>();
                  c->count = Convert<double>::fromJs(rt, arg(args, n, 0), Path{"Counter", "argument 'start'"});
                  return Convert<Ref<m_manual::Counter>>::toJs(rt, host, c);
                });
              });
}

const ModuleDef kModules[] = {{"manual", install}};
}  // namespace

namespace lucent::js {
const ModuleDef* registeredModules(size_t& count) {
  count = sizeof(kModules) / sizeof(kModules[0]);
  return kModules;
}
void resetModuleState() {}
}  // namespace lucent::js
