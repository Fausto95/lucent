// Number to string (lucent/number.h): String(x), toString(radix), toFixed,
// toExponential and toPrecision, checked case by case against the corpus
// node writes (number/corpus.ts). Built and run by
// `packages/runtime/test/run.sh` (which writes the corpus), also under
// ASan/UBSan and TSan. With LUCENT_NUMBER_BENCH=1 it also prints the cost of
// each form over the corpus's doubles (build with -O2).
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

#include "lucent/lucent.h"

using namespace lucent;

namespace {

struct Case {
  std::string op;
  double value;
  double arg;
  bool hasArg;
  std::string expected;
};

double fromBits(const std::string& hex) {
  uint64_t bits = std::stoull(hex, nullptr, 16);
  double d;
  std::memcpy(&d, &bits, sizeof d);
  return d;
}

std::vector<Case> readCorpus(const char* path) {
  std::ifstream in(path);
  if (!in) {
    std::fprintf(stderr, "cannot read the corpus at %s\n", path);
    std::exit(2);
  }

  std::vector<Case> cases;
  for (std::string line; std::getline(in, line);) {
    std::vector<std::string> f;
    std::istringstream split(line);
    for (std::string field; std::getline(split, field, '\t');) f.push_back(field);
    if (f.size() != 4) {
      std::fprintf(stderr, "bad corpus line: %s\n", line.c_str());
      std::exit(2);
    }

    bool hasArg = f[2] != "-";
    cases.push_back({f[0], fromBits(f[1]), hasArg ? std::stod(f[2]) : 0, hasArg, f[3]});
  }

  return cases;
}

using Form = String (*)(const Case&);

/// Each operation of the corpus, as the runtime computes it.
const std::map<std::string, Form>& forms() {
  static const std::map<std::string, Form> table = {
      {"str", [](const Case& c) { return numberToString(c.value); }},
      {"radix", [](const Case& c) { return numberToString(c.value, c.arg); }},
      {"fixed", [](const Case& c) { return numberToFixed(c.value, c.arg); }},
      {"precision", [](const Case& c) { return numberToPrecision(c.value, c.arg); }},
      {"exp",
       [](const Case& c) { return c.hasArg ? numberToExponential(c.value, c.arg) : numberToExponential(c.value); }},
  };
  return table;
}

int agreesWithJavaScript(const std::vector<Case>& cases) {
  std::map<std::string, int> wrongBy;
  int wrong = 0;

  for (const Case& c : cases) {
    std::string actual = forms().at(c.op)(c).toUtf8();
    if (actual == c.expected) continue;

    wrongBy[c.op]++;
    if (wrong++ < 20) {
      uint64_t bits;
      std::memcpy(&bits, &c.value, sizeof bits);
      std::fprintf(stderr, "corpus: %s(%016llx%s%s) gave %s, JavaScript %s\n", c.op.c_str(),
                   static_cast<unsigned long long>(bits), c.hasArg ? ", " : "",
                   c.hasArg ? std::to_string(static_cast<int>(c.arg)).c_str() : "", actual.c_str(),
                   c.expected.c_str());
    }
  }

  std::printf("number: %zu corpus cases, %d disagree with JavaScript", cases.size(), wrong);
  for (const auto& [op, n] : wrongBy) std::printf(" (%s: %d)", op.c_str(), n);
  std::printf("\n");
  return wrong;
}

/// The mean cost of each form over the corpus's cases of it.
void measure(const std::vector<Case>& cases) {
  for (const auto& [op, form] : forms()) {
    std::vector<const Case*> mine;
    for (const Case& c : cases)
      if (c.op == op) mine.push_back(&c);
    if (mine.empty()) continue;

    size_t sink = 0;
    auto t0 = std::chrono::steady_clock::now();
    for (int round = 0; round < 5; round++)
      for (const Case* c : mine) sink += form(*c).length();
    auto ns = std::chrono::duration<double, std::nano>(std::chrono::steady_clock::now() - t0).count();

    std::printf("bench: %-9s %8.1f ns per call (%zu)\n", op.c_str(), ns / (5.0 * mine.size()), sink % 10);
  }
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 2) {
    std::fprintf(stderr, "usage: number_test <corpus> (run.sh writes it with number/corpus.ts)\n");
    return 2;
  }

  std::vector<Case> cases = readCorpus(argv[1]);
  int wrong = agreesWithJavaScript(cases);

  if (const char* bench = std::getenv("LUCENT_NUMBER_BENCH"); bench && std::string(bench) == "1") measure(cases);

  return wrong == 0 ? 0 : 1;
}
