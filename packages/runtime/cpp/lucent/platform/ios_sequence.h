// Lucent runtime — Swift AsyncSequences collected by Lucent functions
// (lucent:ios's AsyncSequence.collect), for *.ios.lucent.ts units
// (Objective-C++ with ARC, iOS only).
//
// The generated Swift file (LucentShims.swift) defines the C functions:
// lucent_swift_collect starts a task iterating the sequence, handing each
// element (retained) with a continuation to resume, and calls `done` once,
// with the error it ended with (retained) or none; lucent_swift_resume
// resumes the iteration after an element was handled; lucent_swift_cancel
// cancels the task and releases it.
#pragma once

#include <memory>
#include <utility>

#include "../operation.h"
#include "ios.h"

extern "C" {
void* lucent_swift_collect(void* sequence, void* ctx, void (*element)(void* ctx, void* e, void* resume),
                           void (*done)(void* ctx, void* error));
void lucent_swift_resume(void* resume);
void lucent_swift_cancel(void* task);
}

namespace lucent::objc {

/**
 * Collects a sequence: `each(id)` (Lucent code, which may throw) runs on
 * the Lucent thread for each element, in order, the iteration waiting for
 * it. The promise settles when the sequence ends, with its error or the
 * first `each` throws (which cancels the iteration); aborting `signal`, or
 * the calling context's scope ending, cancels it. What arrives after the
 * operation settled is released unread.
 */
template <class F>
Promise<void> collectSequence(const NativeRef& sequence, F each, Opt<AbortSignal> signal = {}) {
  using Op = Operation<void>;
  struct Collecting {
    std::weak_ptr<Op> op;
    F each;
  };

  auto start = [&](const std::shared_ptr<Op>& op) -> std::function<void()> {
    auto* c = new Collecting{op, std::move(each)};
    void* task = lucent_swift_collect(
        (__bridge void*)unwrap(sequence), c,
        [](void* ctx, void* e, void* resume) {
          auto* c = static_cast<Collecting*>(ctx);
          id element = (__bridge_transfer id)e;
          postCallback([c, element, resume] {
            if (auto op = c->op.lock(); op && op->state() == OperationState::Pending) {
              try {
                c->each(element);
              } catch (...) {
                op->fail(currentError(std::current_exception()));
              }
            }
            lucent_swift_resume(resume);
          });
        },
        [](void* ctx, void* e) {
          auto* c = static_cast<Collecting*>(ctx);
          NSError* error = (__bridge_transfer NSError*)e;
          postCallback([c, error] {
            if (auto op = c->op.lock()) {
              if (error)
                op->fail(fromNSError(error, "AsyncSequence.collect"));
              else
                op->succeed();
            }
            delete c;
          });
        });
    return [task] { lucent_swift_cancel(task); };
  };
  return nativeOperation<void>(start, signal);
}

}  // namespace lucent::objc
