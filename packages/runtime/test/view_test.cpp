// Unit tests for what compiled views share (lucent/view.h): the main
// context's reactive graph, events' routes, where a view's errors go, and
// how a mount's host hears that the mount's code ran (its content may have
// changed size).
// Built and run by `packages/runtime/test/run.sh`, also under ASan/UBSan and
// TSan.
#include <chrono>
#include <cstdio>
#include <future>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

#include <unistd.h>

#include "lucent/lucent.h"
#include "lucent/view.h"

using namespace lucent;

static int failures = 0;
static int checks = 0;

#define CHECK(cond)                                                                 \
  do {                                                                              \
    checks++;                                                                       \
    if (!(cond)) {                                                                  \
      failures++;                                                                   \
      std::fprintf(stderr, "%s:%d: CHECK failed: %s\n", __FILE__, __LINE__, #cond); \
    }                                                                               \
  } while (0)

/// Runs `f` as a turn of the main context and returns its result.
template <class F>
static auto onUi(F f) -> decltype(f()) {
  using R = decltype(f());
  std::promise<R> result;
  auto future = result.get_future();

  ExecutionContext::main().post([&] {
    if constexpr (std::is_void_v<R>) {
      f();
      result.set_value();
    } else {
      result.set_value(f());
    }
  });

  if (future.wait_for(std::chrono::seconds(10)) != std::future_status::ready) {
    std::fprintf(stderr, "a UI turn did not run within 10 s\n");
    std::abort();
  }

  return future.get();
}

/// Captures what reportUncaught writes to stderr while it lives.
class StderrCapture {
 public:
  StderrCapture() {
    std::fflush(stderr);
    file_ = std::tmpfile();
    saved_ = dup(2);
    dup2(fileno(file_), 2);
  }

  std::string finish() {
    std::fflush(stderr);
    dup2(saved_, 2);
    close(saved_);

    std::string text;
    std::rewind(file_);
    for (int c; (c = std::fgetc(file_)) != EOF;) text.push_back(static_cast<char>(c));
    std::fclose(file_);
    return text;
  }

 private:
  FILE* file_;
  int saved_;
};

/// One graph for every view on the main context, owned by it.
static void oneMainGraph() {
  auto [a, b] = onUi([] { return std::make_pair(ui::mainGraph(), ui::mainGraph()); });

  CHECK(a == b);
  CHECK(&a->owner() == &ExecutionContext::main());
}

/// An event goes where its route says: copies share it, so replacing the
/// route redirects what a native subscription made once already sends.
static void eventsFollowTheirRoute() {
  std::vector<std::string> sent = onUi([] {
    std::vector<std::string> out;
    ui::Event<double, Opt<String>> changed;

    // What a native subscription keeps: a copy, made once.
    auto subscription = [changed](double v) { changed(v, Opt<String>()); };

    subscription(1);

    changed.route([&out](double v, Opt<String> source) { out.push_back("first " + std::to_string(int(v)) + (source.has() ? " with" : "")); });
    subscription(2);

    changed.route([&out](double v, Opt<String>) { out.push_back("second " + std::to_string(int(v))); });
    subscription(3);

    changed.route(nullptr);
    subscription(4);

    return out;
  });

  CHECK((sent == std::vector<std::string>{"first 2", "second 3"}));
}

/// A view's error names the component and the source line it maps to.
static void errorsNameTheirSource() {
  StderrCapture capture;

  try {
    throwError(String::fromLatin1("TypeError"), String::fromLatin1("no meter"));
  } catch (...) {
    ui::reportViewError(std::current_exception(), "@acme/app/meter#Meter", "setup", "meter.lucent.tsx:12");
  }

  std::string text = capture.finish();
  CHECK(text.find("@acme/app/meter#Meter setup (meter.lucent.tsx:12): TypeError: no meter") != std::string::npos);
}

/// Every entry into a mount marks its content; its host hears of it once,
/// when the outermost entry on the main context ends, whichever mounts it
/// entered.
static void hostsHearOnceAnEntryEnds() {
  auto heard = onUi([] {
    std::vector<std::string> out;
    auto a = ui::Content::create([&out] { out.push_back("a"); });
    auto b = ui::Content::create([&out] { out.push_back("b"); });

    {
      ui::ContentEntry outer(a);

      CHECK(ui::activeContent().lock() == a);

      {
        ui::ContentEntry inner(b);

        CHECK(ui::activeContent().lock() == b);

        ui::ContentEntry again(a);
      }

      CHECK(ui::activeContent().lock() == a);
      CHECK(out.empty());
    }

    CHECK(!ui::activeContent().lock());
    out.push_back("|");

    {
      ui::ContentEntry second(b);
    }

    return out;
  });

  CHECK((heard == std::vector<std::string>{"a", "b", "|", "b"}));
}

/// Code of the mount listens to its content's changes (a Flex marking its
/// leaves to measure again): before the host measures, once per flush;
/// a listener taken back hears nothing more, and its marks are no change.
static void listenersHearBeforeTheHost() {
  auto heard = onUi([] {
    std::vector<std::string> out;
    std::shared_ptr<ui::Content> content;
    content = ui::Content::create([&out] { out.push_back("host"); });

    const auto first = content->listen([&] {
      out.push_back("first");
      content->invalidate();
    });
    content->listen([&out] { out.push_back("second"); });

    {
      ui::ContentEntry entry(content);
    }

    content->unlisten(first);
    out.push_back("|");

    {
      ui::ContentEntry entry(content);
    }

    return out;
  });

  CHECK((heard == std::vector<std::string>{"first", "second", "host", "|", "second", "host"}));
}

/// A function made in a setup enters its mount each time it runs, whoever
/// calls it: what it makes in turn belongs to the same mount.
static void functionsEnterTheirMount() {
  auto heard = onUi([] {
    std::vector<std::string> out;
    auto content = ui::Content::create([&out] { out.push_back("measured"); });
    std::weak_ptr<ui::Content> made;

    auto callback = [&] {
      ui::ContentEntry setup(content);

      return ui::inContent(ui::activeContent(), [&made](double x) {
        made = ui::activeContent();
        return x * 2;
      });
    }();

    out.clear();

    double doubled = callback(21);

    out.push_back(std::to_string(static_cast<int>(doubled)));
    CHECK(made.lock() == content);

    // A mount that has gone: the function runs, and nobody hears.
    auto orphan = ui::inContent(std::weak_ptr<ui::Content>(), [&out] { out.push_back("orphan"); });

    orphan();

    return out;
  });

  CHECK((heard == std::vector<std::string>{"measured", "42", "orphan"}));
}

/// invalidateSize() outside any entry (code after an await): the host hears
/// once, in a later turn, after the rest of this one's changes. Marks made
/// while the host measures (its own code runs) change nothing.
static void invalidationsOutsideAnEntryWaitForTheTurn() {
  std::vector<std::string> out;
  std::shared_ptr<ui::Content> content;

  onUi([&] {
    content = ui::Content::create([&] {
      out.push_back("measured");

      // Measuring runs the mount's code (a subclass's sizeThatFits):
      // not a change.
      ui::ContentEntry measuring(content);
      ui::invalidateSize(content);
    });

    ui::invalidateSize(content);
    ui::invalidateSize(content);
    out.push_back("turn ends");
  });

  onUi([] {});

  CHECK((out == std::vector<std::string>{"turn ends", "measured"}));

  onUi([&] { content.reset(); });
}

/// Off the main thread an entry does nothing: no mount's code runs there.
static void entriesBelongToTheMainThread() {
  int heard = 0;
  auto content = onUi([&] { return ui::Content::create([&heard] { ++heard; }); });

  {
    ui::ContentEntry elsewhere(content);

    CHECK(!ui::activeContent().lock());
  }

  onUi([] {});
  CHECK(heard == 0);
  onUi([&] { content.reset(); });
}

int main() {
  oneMainGraph();
  eventsFollowTheirRoute();
  errorsNameTheirSource();
  hostsHearOnceAnEntryEnds();
  listenersHearBeforeTheHost();
  functionsEnterTheirMount();
  invalidationsOutsideAnEntryWaitForTheTurn();
  entriesBelongToTheMainThread();

  std::printf("view: %d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
