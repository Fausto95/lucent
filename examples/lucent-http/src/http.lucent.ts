// HTTP requests from native code. iOS awaits URLSession's async
// data(for:), which Lucent turns into a promise that an AbortSignal
// cancels. Android uses HttpURLConnection from the SDK, which blocks: the
// request runs in an async export, on the Lucent thread, so it holds the
// Lucent lock until it returns, and its timeouts bound that. Both read the
// headers JavaScript names, and the body as UTF-8 text.
import { error, errorCode, utf8Decode, utf8Encode } from "lucent:core";
import { asString } from "lucent:ios";
import { PLATFORM } from "lucent:platform";
import { HTTPURLResponse, NSMutableURLRequest, NSURL, URLSession } from "lucent:ios/Foundation";
import { HttpURLConnection, URL } from "lucent:android/java.net";
import { OutputStreamWriter } from "lucent:android/java.io";
import { Scanner } from "lucent:android/java.util";

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";

export type Request = {
  url: string;
  method?: Method;
  headers?: Record<string, string>;
  /** A UTF-8 body, for POST, PUT and PATCH. */
  body?: string;
  /** Seconds before the request fails with E_HTTP_TIMEOUT. */
  timeout?: number;
  /** Response headers to read, by name; HTTP names are case-insensitive. */
  read?: string[];
};

export type Response = {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: string;
};

const DEFAULT_TIMEOUT = 15;

function checked(request: Request): { url: string; method: Method; timeout: number } {
  if (!/^https?:\/\//.test(request.url))
    throw error("E_HTTP_URL", `${request.url} is not an http or https URL`);
  const method = request.method ?? "GET";
  if (request.body !== undefined && (method === "GET" || method === "HEAD"))
    throw error("E_HTTP_BODY", `a ${method} request has no body`);
  const timeout = request.timeout ?? DEFAULT_TIMEOUT;
  if (!(timeout > 0 && timeout <= 600))
    throw error("E_HTTP_TIMEOUT", `timeout ${timeout} s is outside (0, 600]`);
  return { url: request.url, method, timeout };
}

// --- iOS: URLSession ---------------------------------------------------------

/** URLError codes (NSURLErrorDomain) as this module's. */
function iosFailure(e: Error): Error {
  const code = errorCode(e) ?? "";
  if (code === "NSURLErrorDomain:-1001") return error("E_HTTP_TIMEOUT", e.message);
  if (code === "NSURLErrorDomain:-1009") return error("E_HTTP_OFFLINE", e.message);
  if (code === "NSURLErrorDomain:-999") return e; // cancelled: the AbortError stays one
  return error("E_HTTP_NETWORK", e.message);
}

async function iosSend(request: Request, signal?: AbortSignal): Promise<Response> {
  const { url, method, timeout } = checked(request);
  const target = NSURL.string(url);
  if (!target) throw error("E_HTTP_URL", `${url} is not a URL`);

  const req = new NSMutableURLRequest(target);
  req.httpMethod = method;
  req.timeoutInterval = timeout;
  // addValue(_:forHTTPHeaderField:): NSObject's setValue(_:forKey:) would take setValue's name.
  for (const [name, value] of Object.entries(request.headers ?? {})) req.addValue(value, name);
  if (request.body !== undefined) req.httpBody = utf8Encode(request.body);

  try {
    const [data, response] = await URLSession.shared.data(req, signal);
    if (!(response instanceof HTTPURLResponse))
      throw error("E_HTTP_NETWORK", `${url} did not answer with HTTP`);
    const status = Number(response.statusCode);
    // allHeaderFields is [AnyHashable: Any]: string keys, NSObject values.
    const all: Record<string, string> = {};
    for (const [name, value] of Object.entries(response.allHeaderFields))
      all[name.toLowerCase()] = asString(value) ?? "";
    const headers: Record<string, string> = {};
    for (const name of request.read ?? []) {
      const value = all[name.toLowerCase()];
      if (value !== undefined) headers[name.toLowerCase()] = value;
    }
    return { status, ok: status >= 200 && status < 300, headers, body: utf8Decode(data) };
  } catch (e) {
    throw iosFailure(e as Error);
  }
}

// --- Android: HttpURLConnection ----------------------------------------------

/** The whole stream as UTF-8 text: Scanner's "\A" delimiter matches only the start. */
function readAll(connection: HttpURLConnection, status: number): string {
  const stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
  if (!stream) return "";
  const scanner = new Scanner(stream, "UTF-8").useDelimiter("\\A");
  try {
    return scanner?.hasNext() ? (scanner.next() ?? "") : "";
  } finally {
    stream.close();
  }
}

function androidFailure(e: Error): Error {
  const code = errorCode(e) ?? "";
  if (code === "java.net.SocketTimeoutException") return error("E_HTTP_TIMEOUT", e.message);
  if (code === "java.net.UnknownHostException") return error("E_HTTP_OFFLINE", e.message);
  if (code.startsWith("java.") || code.startsWith("javax."))
    return error("E_HTTP_NETWORK", e.message);
  return e;
}

function androidSend(request: Request): Response {
  const { url, method, timeout } = checked(request);
  const opened = new URL(url).openConnection();
  if (!(opened instanceof HttpURLConnection))
    throw error("E_HTTP_URL", `${url} did not open an HTTP connection`);
  const connection = opened;

  try {
    connection.setRequestMethod(method);
    connection.setConnectTimeout(Math.round(timeout * 1000));
    connection.setReadTimeout(Math.round(timeout * 1000));
    for (const [name, value] of Object.entries(request.headers ?? {}))
      connection.setRequestProperty(name, value);
    if (request.body !== undefined) {
      connection.setDoOutput(true);
      const out = connection.getOutputStream();
      if (out) {
        const writer = new OutputStreamWriter(out, "UTF-8");
        writer.write(request.body);
        writer.close();
      }
    }

    const status = connection.getResponseCode();
    const headers: Record<string, string> = {};
    for (const name of request.read ?? []) {
      const value = connection.getHeaderField(name);
      if (value !== null) headers[name.toLowerCase()] = value;
    }
    const body = method === "HEAD" ? "" : readAll(connection, status);
    return { status, ok: status >= 200 && status < 300, headers, body };
  } catch (e) {
    throw androidFailure(e as Error);
  } finally {
    connection.disconnect();
  }
}

// --- The module --------------------------------------------------------------

/**
 * Sends `request` and resolves with its response, whatever its status.
 * Rejects with E_HTTP_URL, E_HTTP_BODY, E_HTTP_TIMEOUT, E_HTTP_OFFLINE or
 * E_HTTP_NETWORK; on iOS, `signal` cancels it with an AbortError.
 */
export async function send(request: Request, signal?: AbortSignal): Promise<Response> {
  if (PLATFORM === "ios") return iosSend(request, signal);
  signal?.throwIfAborted();
  return androidSend(request);
}

/** GETs `url` and resolves with its body; rejects with E_HTTP_STATUS when the status isn't 2xx. */
export async function getText(url: string, signal?: AbortSignal): Promise<string> {
  const response = await send({ url }, signal);
  if (!response.ok) throw error("E_HTTP_STATUS", `${url} answered ${response.status}`);
  return response.body;
}
