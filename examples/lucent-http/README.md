# lucent-http

HTTP requests written in Lucent: one module that awaits `URLSession` on
iOS and uses `HttpURLConnection` from the Android SDK, with no Swift,
Kotlin or third-party library.

```ts
import { send } from "lucent-http";

const controller = new AbortController();
const response = await send(
  {
    url: "https://httpbin.org/post",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hello: "world" }),
    timeout: 10,
    read: ["content-type"],
  },
  controller.signal,
);
response.status; // 200
JSON.parse(response.body);
```

A failed request rejects with an error whose `code` says why:
`E_HTTP_URL`, `E_HTTP_BODY`, `E_HTTP_TIMEOUT`, `E_HTTP_OFFLINE` or
`E_HTTP_NETWORK`. A response with any status resolves; `ok` is true for
2xx. `getText(url)` is the short form for a GET that must succeed.

## Files

- `src/http.lucent.ts`: the module, `send(request, signal?)` and
  `getText(url, signal?)`.
- `lucent.json`: declares `android.permission.INTERNET`, which the native
  package's manifest merges into the app's.

## What it shows

- **A Swift `async` API.** `URLSession.shared.data(for:)` is `async throws`
  in Swift; in Lucent it's a promise, and its last parameter takes an
  `AbortSignal` that cancels the task. `URLError` codes arrive as
  `NSURLErrorDomain:<code>` and are mapped to the module's codes.
- **Bridged Foundation types.** `NSMutableURLRequest` and `NSURL` are passed
  where Swift takes `URLRequest` and `URL`, and `Data` is a `Uint8Array`
  that `utf8Decode` reads.
- **A blocking Java API.** `HttpURLConnection` blocks until the server
  answers. The request runs in an `async` export, on the Lucent thread, so
  it never blocks the JS thread; it does hold the Lucent lock, so other
  module code waits while it runs, and its timeouts bound that. On Android
  `signal` is only checked before the request starts.
- **Java exceptions as errors.** `SocketTimeoutException` and
  `UnknownHostException` arrive with their class name as `errorCode(e)`.

## Build and check it

```sh
pnpm install && pnpm build                       # at the repository root
cd examples/lucent-http
node ../../packages/lucent/bin/lucent.cjs build --platforms host
```

`--platforms host` compiles the module without either SDK: platform code
is untyped and becomes stubs that throw. On a Mac with Xcode, or with the
Android SDK, `lucent build` types each branch against the SDK. Plain-HTTP
URLs need App Transport Security exceptions on iOS and
`usesCleartextTraffic` on Android, as any app does.

Compiled with `--platforms host` on Linux. Not yet typed against the SDKs
or run on a device.
