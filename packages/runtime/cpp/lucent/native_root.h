// Lucent runtime — the native root: module state with or without a
// JavaScript runtime (decision 0090).
//
// Module state is the process's, and lives in generations. A generation
// starts at the first use of any module: a JavaScript Host's install, a
// native entry point's call, or the app's launch. Starting it runs each
// module's top level (the generated initializer), for the runtime the
// starting thread runs for. It ends when the last live JavaScript runtime
// is torn down, and only while nothing native holds the state: then its
// destroy hooks run, and the next use starts a new one. A process only
// native code runs keeps one generation to its end.
//
// Work a native call starts belongs to that call (NativeCall), not to a
// JavaScript runtime: its scopes end with it, and the call holds the state
// while it lasts.
#pragma once

#include <atomic>
#include <cstdint>
#include <memory>
#include <mutex>
#include <unordered_map>

#include "execution.h"

namespace lucent {

/// The generated initializer: each module's top level, in import order,
/// holding its actor.
using ModuleInitializer = void (*)();

/// Starts a generation when none lasts, running `init` on the calling
/// thread, and returns whether it did. One that another thread is starting
/// is waited for. Called holding no actor.
bool ensureModuleState(ModuleInitializer init);

/// The generation lasting now: 0 while none does (before the first use,
/// and between the end of one and the next use).
uint64_t moduleGeneration();

/// Ends the generation when no JavaScript runtime but `leaving` is live
/// and nothing native holds the state: its destroy hooks run, last
/// registered first, each holding its actor. Returns whether it ended it.
/// From a Host's teardown, holding no actor.
bool endModuleStateUnlessHeld(RuntimeId leaving);

/// How many holds on module state there are now (for tests and tools).
size_t moduleStateHolds();

/// Holds module state while it lives, so that no runtime's teardown ends
/// its generation: a launch module, a native call, an instance the OS made.
class ModuleStateHold {
 public:
  ModuleStateHold();
  ~ModuleStateHold();

  ModuleStateHold(const ModuleStateHold&) = delete;
  ModuleStateHold& operator=(const ModuleStateHold&) = delete;
};

/// A call native code makes into module code with no JavaScript runtime
/// (a native entry point's). Code run for it (`Entry`, and the turns it
/// posts) runs for this call, never for the last attached JavaScript
/// runtime, and the work it starts belongs to the call's scopes. `end()`
/// cancels that work and releases the state the call holds.
class NativeCall final : public RuntimeWork, public std::enable_shared_from_this<NativeCall> {
 public:
  /// A new call, attached and holding module state until it ends.
  static std::shared_ptr<NativeCall> start();

  ~NativeCall() override;

  RuntimeId id() const { return id_; }

  /// Ends the call: its scopes are disposed (their work cancelled, their
  /// cleanups run) and its hold released. Calling it again does nothing.
  void end();

  std::shared_ptr<Scope> scopeFor(ExecutionContext& actor) override;
  bool live() const override { return live_.load(); }
  bool javascript() const override { return false; }

  /// Runs the calling thread for this call while it lives (RuntimeEntry).
  class Entry {
   public:
    explicit Entry(const NativeCall& call) : entry_(call.id()) {}

   private:
    RuntimeEntry entry_;
  };

 private:
  explicit NativeCall(RuntimeId id);

  const RuntimeId id_;
  std::atomic<bool> live_{true};
  std::unique_ptr<ModuleStateHold> hold_;
  std::mutex mutex_;
  std::unordered_map<ExecutionContext*, std::shared_ptr<Scope>> scopes_;
};

}  // namespace lucent
