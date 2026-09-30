/**
 * The view contract: what the compiler knows about each component, as plain
 * data. Code generators and both platform hosts read this one description;
 * nothing about a component is registered or declared anywhere else.
 *
 * A component is identified by `<package>/<module path>#<export>`; a
 * module's basename never identifies it. Everything else derives from the
 * checked source: the props object's type gives the props (plain data) and
 * the events (callback props), the object given to `expose` gives the ref
 * commands, and each platform's program gives the root view class. A
 * `children: Children` prop says the component takes React children, which
 * its host mounts in the slot its setup places.
 */
import { createHash } from "node:crypto";
import type { Platform } from "../sdk/schema.ts";

/** Plain data a view receives as a prop, an event sends, or a command takes and answers. */
export type ViewType =
  | { readonly k: "number" }
  | { readonly k: "boolean" }
  | { readonly k: "string" }
  /** A union of string literals, sorted. */
  | { readonly k: "enum"; readonly values: readonly string[] }
  | { readonly k: "array"; readonly element: ViewType }
  | { readonly k: "object"; readonly fields: readonly ViewField[] }
  /** The value, or null. */
  | { readonly k: "nullable"; readonly inner: ViewType };

/**
 * A prop, an object field or a parameter. `optional`: it may be missing
 * (undefined); a missing value, null and an unchanged value are distinct.
 */
export interface ViewField {
  readonly name: string;
  readonly type: ViewType;
  readonly optional: boolean;
}

/**
 * How an event reaches JavaScript. `discrete`: each one, at React's
 * discrete priority (a tap, a change of selection). `continuous`: each
 * one, at a lower priority, so React may batch what they update (a
 * drag, a timer). `coalesced`: continuous, and while the view's latest
 * waiting event is one of this type, a new one replaces it: JavaScript
 * hears the latest value. A view's events arrive in the order it sent
 * them. lucent:ui's `Continuous<F>` and `Coalesced<F>` mark the callback's
 * type; unmarked events are discrete.
 */
export type EventDelivery = "discrete" | "continuous" | "coalesced";

/**
 * A callback prop. JavaScript keeps the function; the view holds an event
 * slot, numbered in prop order, and calling the prop posts its arguments.
 */
export interface EventDescription {
  readonly name: string;
  readonly slot: number;
  readonly optional: boolean;
  readonly params: readonly ViewField[];
  readonly delivery: EventDelivery;
}

/**
 * How a command answers: `enqueue` runs it on the view's thread and
 * answers nothing; `request` answers a promise, resolved with `value` (none:
 * undefined) through the host's completion channel.
 */
export type CommandResult =
  | { readonly kind: "enqueue" }
  | { readonly kind: "request"; readonly value?: ViewType };

/** A method of the component's ref. */
export interface CommandDescription {
  readonly name: string;
  readonly params: readonly ViewField[];
  readonly result: CommandResult;
}

/** How one platform implements a component. */
export interface PlatformBinding {
  /** The platform class the component returns: its SDK module and name. */
  readonly root: { readonly module: string; readonly name: string };
  /**
   * The class the platform host registers: `<registration>ComponentView` on
   * iOS, `dev.lucent.generated.<registration>Manager` on Android.
   */
  readonly artifact: string;
}

export interface ComponentDescription {
  /** `<package>/<module path>#<export>`: unique in the app and stable across builds. */
  readonly id: string;
  readonly package: string;
  /** The module's path in its package (under its sources for a Lucent package), without extensions. */
  readonly module: string;
  readonly export: string;
  /** The Lucent module whose JavaScript exports the component. */
  readonly jsModule: string;
  /** The native registration name, derived from `id` alone. */
  readonly registration: string;
  readonly props: readonly ViewField[];
  readonly events: readonly EventDescription[];
  readonly commands: readonly CommandDescription[];
  /** Whether it takes React children (`children: Children`), and may be left without; none: it takes none. */
  readonly children?: { readonly optional: boolean };
  /** The platforms whose programs implement it (none on the host). */
  readonly platforms: Partial<Record<Platform, PlatformBinding>>;
  /** Where it is declared, for messages; never part of its identity. */
  readonly source: { readonly file: string; readonly line: number; readonly column: number };
}

/** The version of the description's layout; a change consumers must follow bumps it. */
export const VIEW_CONTRACT_VERSION = 2;

/** A component's identity. */
export function componentId(pkg: string, module: string, name: string): string {
  return `${pkg}/${module}#${name}`;
}

/**
 * The native registration name of a component: `Lucent<export>_<hash>`,
 * where the hash is the first 12 hex digits of the identity's SHA-256, so
 * components with the same export and basename never share it. Valid as a
 * C++, Objective-C and Java identifier.
 */
export function registrationName(id: string): string {
  const name = id.slice(id.lastIndexOf("#") + 1).replace(/[^A-Za-z0-9_]/g, "_");
  const hash = createHash("sha256").update(id).digest("hex").slice(0, 12);

  return `Lucent${name}_${hash}`;
}

/** What each platform host registers for a component. */
const ARTIFACTS: Record<Platform, (registration: string) => string> = {
  ios: (r) => `${r}ComponentView`,
  android: (r) => `dev.lucent.generated.${r}Manager`,
};

export function artifactName(platform: Platform, registration: string): string {
  return ARTIFACTS[platform](registration);
}
