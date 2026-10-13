# Tracing

A trace says why a call, a frame or a build was slow. It shows whether a
job waited for its context, waited for an actor's lock, waited for a
compute worker, or spent its time copying bytes. The runtime side is
`packages/runtime/cpp/lucent/trace.h`, and the CLI side `lucent trace`
(`packages/lucent/src/cli/trace.ts`). Tracing is off by default, and
then costs one relaxed load where it would record (`trace::enabled()`).

## Starting a trace

The runtime reads its setting once per process, when the module context
starts (`Actor::shared()` in `scheduler.cpp`). Change it, then restart
the app or the process.

| Setting                                  | Records                                       |
| ---------------------------------------- | --------------------------------------------- |
| `LUCENT_TRACE=1`                         | Into the in-memory buffer only                |
| `LUCENT_TRACE=platform`                  | The buffer, mirrored live into `os_signpost`  |
| `LUCENT_TRACE=<file>.json`               | The buffer, written as a Chrome trace at exit |
| `adb shell setprop debug.lucent.trace 1` | Android: the buffer, mirrored into ATrace     |

`LUCENT_TRACE` is an environment variable: a test's or tool's, or an Xcode
scheme's. Android reads only the `debug.lucent.trace` property, and always
mirrors into ATrace, which costs a check while nothing records. A value
ending in `.json` there is also a file to write at exit.

Native code may call `trace::start()`, `stop()`, `events()` and
`writeChromeJson(path)` itself. JavaScript can't start or read a trace.

## What it records

Each event has a category, a name, a start and a duration on the steady
clock, its thread and its execution context. Some carry an id, a parent,
a value, a count, a detail or a source site.

| Category     | Event                                            | Recorded when                                                       |
| ------------ | ------------------------------------------------ | ------------------------------------------------------------------- |
| `entry`      | The export's name, at its `.lucent.ts` line      | JavaScript calls an exported function, method or constructor        |
| `lock`       | `lucent-lock`                                    | A thread waits for an actor's lock it doesn't hold yet              |
| `queue`      | `wait`                                           | A job posted to any execution context waits to run                  |
| `run`        | `run`                                            | That job runs                                                       |
| `run`        | `enter`                                          | A callback enters an executor or the main context at once           |
| `queue`      | `js.wait`                                        | An async export's result waits for the JS thread                    |
| `queue`      | `channel.wait`                                   | A value waits in a `Channel`, from its send to its receipt          |
| `queue`      | `channel.dropped`, `channel.refused`             | A full channel drops a value or refuses a send (value: the count)   |
| counter      | `channel.depth`                                  | A channel's queued values after a send or receive, by channel id    |
| `completion` | The export's name                                | That result converts and settles the JS promise                     |
| `compute`    | `compute.wait`, `compute.run`, `compute.deliver` | A compute task waits for a worker, runs, and is delivered           |
| `compute`    | `compute.saturated`, `compute.rejected`          | Every worker is busy (value: queue depth); the queue is full        |
| `copy`       | `transport.copy`                                 | A compute input or a channel send is copied (bytes, objects)        |
| `copy`       | `buffer.copy`                                    | A `NativeBuffer`'s bytes are copied (bytes)                         |
| `alloc`      | `buffer.allocate`, `buffer.adopt`                | A `NativeBuffer` is allocated or adopts native bytes (bytes)        |
| `effect`     | `effect`, at its `.lucent.ts` line               | A view's effect runs: a prop binding, a toolkit slot, an `effect()` |
| `native`     | The name given to `LUCENT_TRACE_SCOPE`           | Native code marks a span                                            |

The `buffer.*`, `channel.dropped`/`refused` and
`compute.saturated`/`rejected` events are instants, `compute.queued` and
`channel.depth` are counters, and the rest are spans. An executor's
`wait`, `run` and `enter` spans carry its label as their detail, so they
read apart from its actor's. Each channel's events share its id. `LUCENT_TRACE_SCOPE` takes its site from `__FILE__` and
`__LINE__`; native code may use it, but generated code emits none.

A synchronous `entry` span covers the lock wait, the argument
conversions, the work and the result. An async one covers creating the
promise and posting the job; the job's `wait` and `run` follow. Sites
come from the compiler (`LUCENT_TRACE_SITE_AT` in `emit/bindings.ts`,
`emit/setups.ts`, `emit/toolkit.ts` and `emit/native-jsx.ts`). They name
the source relative to the project, as `#line` does.

## Correlation

Events that belong together share an id. For an async export, the
`entry`, the job's `wait` and `run`, the `js.wait` and the `completion`
share one (`trace::Correlate` carries it to the post). A compute task's
phases share one too. A job posted while a traced job runs names that
job as its `parent` (`trace::Current`).

The Chrome export (`trace::chromeJson`) draws flow arrows between the
spans of one id, in time order. It puts the dropped count in
`otherData.dropped`.

## Platform tooling

- **Apple** (`LUCENT_TRACE=platform`): signpost intervals on the log
  subsystem `dev.lucent`, category `runtime`, which Instruments'
  os_signpost instrument shows. Each is named by its category (`entry`,
  `lock`, …) with the event's name as its message; instants and counters
  are signpost events. It is opt-in because signposts persist even when
  no tool records.
- **Android**: ATrace async sections named `<category>:<name>`, and
  counters, which Perfetto and systrace show for the app. They need API
  29, looked up at run time. Before it, only instants appear, as empty
  sections.

## `lucent trace`

```sh
lucent trace --runtime trace.json        # or a,b,c.json; --out <file>
```

It writes one Chrome trace, `.lucent/trace.json` by default. The last
build's steps come from `.lucent/build-record.json`: a span for each
timed node, at its `startedAt`, and a mark for the others. Each runtime
trace becomes a process of its own, named after its file. Open the
result in [ui.perfetto.dev](https://ui.perfetto.dev) or
`chrome://tracing`.

It also prints the build's steps, each runtime trace's time per category
with the bytes copies moved, and the ten effect sites that took longest:

```text
✓ wrote .lucent/trace.json  open it in ui.perfetto.dev or chrome://tracing
  build            resolve 12 ms · check 340 ms · generate 25 ms
  trace.json       entry 3.2 ms · queue 41 ms · run 2.9 ms · effect 4.4 ms · copy 6.1 ms (8.4 MB)
                   effect src/rows.lucent.tsx:11  48× 3.1 ms
```

Build steps are timed from the build's start and runtime events on the
steady clock, so the processes share a view, not a timeline.

## Reading a slow async call

- **A queued job**: a long `wait` before a short `run`: the actor was busy.
- **Lock contention**: a long `lucent-lock`: another thread held the actor.
- **A compute stall**: a long `compute.wait` after `compute.saturated`.
- **A copy cost**: a long `transport.copy` with many bytes. A
  `NativeBuffer` moves instead.
- **A busy JS thread**: a long `js.wait` before the `completion`.

## Limits

- The buffer keeps the latest 65,536 events by default and counts the
  ones it drops. It takes one mutex per event: fine for debugging, not
  for continuous production use.
- A file is written only at a normal exit (`std::atexit`). Apps on a
  device rarely exit that way, so use the platform's tooling there.
- Allocations are recorded for native buffers only. Copies at the JSI
  boundary are inside `entry` spans, not `copy` events.
- Not traced: class fields and accessors, exported variables, and the
  main thread's waits for an actor (`enterFromMain`).
- `lucent trace` sums spans only, and spans nest: an `entry` includes its
  `lucent-lock`. `buffer.copy` is an instant, so its bytes are left out
  of the printed totals.

## Related logs

`LUCENT_SIZING_TRACE=1`, or the `debug.lucent.sizing` property set to `1`
on Android, logs each sizing step of a component as a `LUCENT_SIZING`
line (`runtime/cpp/rn/LucentViewSizing.h`). A debug build's
`__lucentDebug.snapshot()` reports what the runtime owns and each mount's
view tree; [architecture.md](architecture.md#debug-features) lists it.
