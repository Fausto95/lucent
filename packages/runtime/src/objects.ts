/** Native identity is represented by an opaque handle. It never contains copied instance state. */
export interface NativeObject {
  dispose(): void;
}
type Constructor = new (...args: unknown[]) => NativeObject;
interface Definition {
  name: string;
  create(...args: unknown[]): number;
  release(handle: number): void;
  asyncMethods?: readonly string[];
  methods: Record<string, (handle: number, ...args: unknown[]) => unknown>;
  getters: Record<string, (handle: number) => unknown>;
  setters: Record<string, (handle: number, value: unknown) => void>;
}
interface State {
  handle: number;
  type: string;
  release(handle: number): void;
  disposed: boolean;
  pending: { count: number };
}
const states = new WeakMap<object, State>();
const classes = new Map<string, Constructor>();
const activeStates = new Map<number, State>();
const instances = new Map<number, WeakRef<NativeObject> | NativeObject>();
const finalizer =
  typeof FinalizationRegistry === "undefined"
    ? undefined
    : new FinalizationRegistry<State>((state) => {
        if (activeStates.get(state.handle) !== state) return;
        state.disposed = true;
        instances.delete(state.handle);
        releaseIfUnused(state);
      });
function attach(value: NativeObject, state: State): NativeObject {
  const previous = activeStates.get(state.handle);
  if (previous) {
    previous.disposed = true;
    // Accepted calls on every wrapper generation share the same native lifetime.
    state.pending = previous.pending;
  }
  activeStates.set(state.handle, state);
  states.set(value, state);
  instances.set(state.handle, typeof WeakRef === "undefined" ? value : new WeakRef(value));
  finalizer?.register(value, state, value);
  return value;
}
export function nativeObjectHandle(value: unknown, type: string): number {
  const state = value && typeof value === "object" ? states.get(value) : undefined;
  if (!state || state.type !== type) throw new TypeError(`Expected native ${type}`);
  if (state.disposed) throw new Error("Native object has been disposed");
  return state.handle;
}
const definitions = new Map<string, Definition>();
export function nativeObjectFromHandle(handle: number, type: string): NativeObject {
  const entry = instances.get(handle);
  const existing = typeof WeakRef !== "undefined" && entry instanceof WeakRef ? entry.deref() : entry;
  if (existing) {
    nativeObjectHandle(existing, type);
    return existing as NativeObject;
  }
  const constructor = classes.get(type),
    definition = definitions.get(type);
  if (!constructor || !definition) throw new Error(`Unregistered native class ${type}`);
  if (!Number.isSafeInteger(handle) || handle <= 0) throw new Error("Invalid native object handle");
  return attach(Object.create(constructor.prototype) as NativeObject, {
    type,
    handle,
    release: definition.release,
    disposed: false,
    pending: { count: 0 },
  });
}
export function defineNativeClass(type: string, definition: Definition): Constructor {
  const existing = classes.get(type);
  if (existing) return existing;
  class SharedNativeObject implements NativeObject {
    constructor(...args: unknown[]) {
      const handle = definition.create(...args);
      attach(this, { type, handle, release: definition.release, disposed: false, pending: { count: 0 } });
    }
    dispose(): void {
      const state = states.get(this);
      if (!state || state.disposed) return;
      state.disposed = true;
      finalizer?.unregister(this);
      instances.delete(state.handle);
      releaseIfUnused(state);
    }
  }
  Object.defineProperty(SharedNativeObject, "name", { value: definition.name });
  for (const [name, method] of Object.entries(definition.methods))
    Object.defineProperty(SharedNativeObject.prototype, name, {
      value(this: NativeObject, ...args: unknown[]) {
        const invoke = () => method(nativeObjectHandle(this, type), ...args);
        if (definition.asyncMethods?.includes(name)) {
          const references = args.filter((value) => !!value && typeof value === "object" && states.has(value));
          return withNativeObjects([this, ...references], invoke);
        }
        return invoke();
      },
    });
  for (const [name, getter] of Object.entries(definition.getters))
    Object.defineProperty(SharedNativeObject.prototype, name, {
      get(this: NativeObject) {
        return getter(nativeObjectHandle(this, type));
      },
      set(this: NativeObject, value: unknown) {
        definition.setters[name]!(nativeObjectHandle(this, type), value);
      },
    });
  classes.set(type, SharedNativeObject);
  definitions.set(type, definition);
  return SharedNativeObject;
}

/** The JS dispatch lease covers time before the native coroutine starts. */
export async function withNativeObjects<T>(values: readonly unknown[], action: () => T | PromiseLike<T>): Promise<T> {
  const retained = [...new Set(values)].map((value) => {
    const state = value && typeof value === "object" ? states.get(value) : undefined;
    if (!state || state.disposed) throw new Error("Invalid or disposed native object");
    return state;
  });
  retained.forEach((state) => state.pending.count++);
  try {
    return await action();
  } finally {
    retained.forEach((state) => {
      state.pending.count--;
      releaseIfUnused(state);
    });
  }
}
function releaseIfUnused(state: State): void {
  const current = activeStates.get(state.handle);
  if (!current || current.pending !== state.pending || !current.disposed || current.pending.count) return;
  activeStates.delete(current.handle);
  current.release(current.handle);
}
