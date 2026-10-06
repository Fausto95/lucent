import { PLATFORM } from "lucent:platform";
import { Shelf } from "lucent:android/dev.orbit.shelf";

const NONE = "no Kotlin on iOS";

/** A copy does not follow the list it was read from; the list itself does. */
export async function listCopies(): Promise<string> {
  if (PLATFORM === "ios") {
    return NONE;
  } else {
    const shelf = new Shelf(["orbit", "ocean"]);
    const copy = shelf.titles;
    copy.push("mine");

    const live = shelf.live;
    live.add("planet");

    return `${copy.join(",")} ${shelf.titles.join(",")} ${live.size()} ${live === shelf.live}`;
  }
}

/** Boxed numbers, null elements, nested lists and arrays, each way. */
export async function listElements(): Promise<string> {
  if (PLATFORM === "ios") {
    return NONE;
  } else {
    const shelf = new Shelf(["orbit", "ocean", "origin"]);
    const rows = shelf.rows(2).map((row) => row.join("+"));
    shelf.replace(["a", "bb"]);

    return `${shelf.lengths().join(",")} ${shelf.withGaps().join(",")} ${rows.join("/")} ${shelf.lengthArray().join(",")} ${shelf.total([1.5, 2])} ${shelf.join(["x", null, "y"])} ${shelf.slice(undefined, 1).join(",")}`;
  }
}

/** A null element where Kotlin says there is none: a TypeError, not a wrong value. */
export async function listNull(): Promise<string> {
  if (PLATFORM === "ios") {
    return NONE;
  } else {
    try {
      return `read ${new Shelf().broken().join(",")}`;
    } catch (e) {
      return (e as Error).name;
    }
  }
}
