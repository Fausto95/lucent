/**
 * How a value is encoded for its native view: 0, as it is; `n`, a nullable
 * value, boxed; `a`, an array's elements; `o`, some of an object's fields.
 */
export type Shape =
  | 0
  | { n: Shape }
  | { a: Shape }
  | { o: readonly { name: string; shape: Shape }[] };

/** A component's description, which the compiler generates into its module's proxy. */
export interface ComponentConfig {
  /** The registration name of its native view. */
  name: string;
  displayName: string;
  /** Whether it takes React children, which its native view mounts in its slot. */
  children?: boolean;
  /** Its props, each under its transport key. */
  props: readonly { name: string; key: string; shape: Shape }[];
  /** Its events, by slot: the handler's key and the event's name. */
  events: readonly { name: string; key: string; event: string }[];
  /** Its ref's commands: whether each answers, and its parameters' shapes. */
  commands: readonly { name: string; request: boolean; params: readonly Shape[] }[];
}

/** The React component rendering a Lucent component's native view. */
export declare function lucentComponent(
  config: ComponentConfig,
  react: object,
  reactNative: object,
): (props: never) => unknown;

/** Settles a command's request: rejected with `error` unless it is null, else resolved with `value`. */
export declare function settleRequest(
  id: number,
  error: string | null | undefined,
  value?: unknown,
): void;
