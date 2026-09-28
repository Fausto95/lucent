# Tracing

A trace tells why a call, a frame or a build was slow, instead of one
"native time" number: whether a job waited for its owner, waited for the
Lucent lock, waited for a compute worker, or spent its time copying bytes.
Tracing is off by default; off, it costs one relaxed load where the
runtime checks it.

## Capturing a runtime trace

| Where                  | How                                                            | Look at it with                          |
| ---------------------- | -------------------------------------------------------------- | ---------------------------------------- |
| Tests, tools, the host | `LUCENT_TRACE=trace.json` (written at exit)                    | `lucent trace --runtime trace.json`      |
| iOS                    | `LUCENT_TRACE=platform` in the scheme's environment            | Instruments, os_signpost (`dev.lucent`)  |
| Android                | `adb shell setprop debug.lucent.trace 1`, then restart the app | Perfetto or systrace, atrace for the app |

`LUCENT_TRACE=1` records into the bounded in-memory buffer only (the latest
65,536 events; older ones are dropped and counted). Native code can start
and stop tracing itself with `lucent::trace::start()` and `stop()`, and
write a Chrome trace with `lucent::trace::writeChromeJson(path)`.

## `lucent trace`

```sh
lucent trace --runtime trace.json
```

writes `.lucent/trace.json`: the last build's steps (from
`.lucent/build-record.json`) and each runtime trace given, each in a
process of its own, in the Chrome trace format. Open it in
[ui.perfetto.dev](https://ui.perfetto.dev) or `chrome://tracing`. It also
prints how long each cause took:

```text
✓ wrote .lucent/trace.json  open it in ui.perfetto.dev or chrome://tracing
  build            resolve 12 ms · check 340 ms · generate 25 ms
  trace.json       entry 3.2 ms · queue 41 ms · run 2.9 ms · compute 18 ms · copy 6.1 ms (8.4 MB)
```

`--out <file>` writes it elsewhere; `--runtime` takes several files,
comma-separated.

## What a trace shows

| Category     | Event                                            | Means                                                               |
| ------------ | ------------------------------------------------ | ------------------------------------------------------------------- |
| `entry`      | the export's name, at its `.lucent.ts` line      | a call from JavaScript, around its conversions and native work      |
| `lock`       | `lucent-lock`                                    | waiting for the Lucent lock (module code running on another thread) |
| `queue`      | `wait`, `js.wait`                                | a job waiting for its owner; a result waiting for the JS thread     |
| `run`        | `run`                                            | a posted job running on its owner                                   |
| `native`     | a `LUCENT_TRACE_SCOPE` name, at its source line  | native work                                                         |
| `completion` | the export's name                                | an async result being delivered to JavaScript                       |
| `compute`    | `compute.wait`, `compute.run`, `compute.deliver` | a compute task waiting for a worker, running, being delivered       |
| `compute`    | `compute.saturated`, `compute.rejected`          | every worker busy (with the queue's depth); the queue full          |
| `copy`       | `transport.copy`, `buffer.copy`                  | bytes copied for a compute task; a native buffer snapshot           |
| `alloc`      | `buffer.allocate`, `buffer.adopt`                | native buffers created                                              |
| `build`      | a build step (`check`, `generate`, …)            | from the build record                                               |

Events that belong together share an id, drawn as arrows in Perfetto: an
async call, the job it posted, the wait of its result for the JS thread
and its delivery. A job posted from another names it as its parent.

So the three usual causes of a slow async call look different:

- **a queued job**: a long `queue`/`wait` before a short `run`: the owner
  (the module context) was busy with something else;
- **a compute stall**: a long `compute.wait` after a `compute.saturated`:
  every worker was busy;
- **a copy cost**: a long `transport.copy` with its bytes: the task's
  input was large; pass a native buffer to move it instead.

## Source locations

Each export's binding names where it is declared, so an `entry` event
points at `stats.lucent.ts:12`, not at generated code. Native code marks
its own spans with `LUCENT_TRACE_SCOPE("name")`; inside Lucent code the
`#line` directives the compiler emits give those the `.lucent.ts` line too.
