import { PLATFORM } from "lucent:platform";
import { Searcher } from "lucent:android/dev.orbit.search";
import { Circle, Meters, Rect, ShapesKt } from "lucent:android/dev.orbit.shapes";
import { Id, Ids } from "lucent:android/dev.orbit.ids";
import { errorCode } from "lucent:core";

const NONE = "no Kotlin on iOS";

/** Titles starting with `prefix`: a suspend function, its limit left to Kotlin's default. */
export async function searchTitles(prefix: string): Promise<string> {
  if (PLATFORM === "ios") {
    return NONE;
  } else {
    const hits = await new Searcher().search(prefix);
    return hits.map((hit) => hit.title).join(" ");
  }
}

/** A search cancelled while it waits: the promise rejects at once, and the coroutine stops. */
export async function cancelledSearch(): Promise<string> {
  if (PLATFORM === "ios") {
    return NONE;
  } else {
    const controller = new AbortController();
    const started = Date.now();
    const pending = new Searcher().search("o", 5, 10000n, controller.signal);
    controller.abort();
    try {
      await pending;
      return "not cancelled";
    } catch (e) {
      return `${(e as Error).name} ${Date.now() - started < 1000}`;
    }
  }
}

/** A Kotlin exception, as the error the promise rejects with. */
export async function failedSearch(): Promise<string> {
  if (PLATFORM === "ios") {
    return NONE;
  } else {
    try {
      await new Searcher().search("!", 1);
      return "no error";
    } catch (e) {
      return `${errorCode(e as Error)}: ${(e as Error).message}`;
    }
  }
}

/** A result that arrives after its call was cancelled is dropped; the searcher still works. */
export async function lateResult(): Promise<string> {
  if (PLATFORM === "ios") {
    return NONE;
  } else {
    const searcher = new Searcher();
    const controller = new AbortController();
    const late = searcher.stubborn(100n, controller.signal);
    controller.abort();
    let outcome = "resolved";
    try {
      await late;
    } catch (e) {
      outcome = (e as Error).name === "AbortError" ? "rejected" : "failed";
    }
    return `${outcome} ${await searcher.stubborn(10n)} ${await searcher.count()}`;
  }
}

/** Defaults left out for Kotlin to fill, beside null passed as null. */
export async function defaults(): Promise<string> {
  if (PLATFORM === "ios") {
    return NONE;
  } else {
    const searcher = new Searcher("named");
    searcher.pageSize = 1;
    const one = await searcher.search("or");
    return `${searcher.describe()} ${searcher.describe("find")} ${searcher.describe("find", null)} ${one.length}`;
  }
}

/** Value classes, a sealed case and its payload, an extension with a default, a top-level property. */
export async function shapes(): Promise<string> {
  if (PLATFORM === "ios") {
    return NONE;
  } else {
    const meters = new Meters(2);
    const scaled = ShapesKt.scaled(new Circle(1));
    const perimeter = ShapesKt.perimeter(new Rect(1, 2));
    ShapesKt.unit = "ft";
    const described =
      scaled instanceof Circle ? `circle ${scaled.radius}` : ShapesKt.describe(scaled);
    return `${ShapesKt.feet(meters).toFixed(2)} ${perimeter.value} ${ShapesKt.circleOf(meters).radius} ${ShapesKt.unit} ${described}`;
  }
}

/**
 * Kotlin Longs beyond 2^53 as exact bigints: a value class over one, a
 * default left out, suspend functions, and a bigint a Long cannot hold.
 */
export async function ids(): Promise<string> {
  if (PLATFORM === "ios") {
    return NONE;
  } else {
    const source = new Ids();
    const next = source.next(new Id(9007199254740993n), 2n);
    const offset = await source.offset(2n ** 62n);
    const first = await source.first();
    let tooBig = "accepted";
    try {
      source.next(next, 2n ** 63n);
    } catch (e) {
      tooBig = (e as Error).name;
    }
    return `${next.value} ${source.plus()} ${offset} ${first.value === source.base} ${tooBig}`;
  }
}
