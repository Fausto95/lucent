/**
 * How a component's props, events and commands travel between its
 * JavaScript proxy and its native view, which both generators follow.
 *
 * Props and event handlers go under short keys of their own rather than
 * their names, so they never meet React Native's view props (`opacity`,
 * `onLayout`…), which the host parses too, nor its limit on key lengths.
 * Events are named by slot, the same for every Lucent component, so React
 * Native's registry of event names never holds two meanings for one.
 */

/** The key of the prop at `index` in the description's props. */
export const propKey = (index: number): string => `p${index}`;

/** The key of the event handler in `slot`: true while JavaScript listens. */
export const handlerKey = (slot: number): string => `e${slot}`;

/** The event the native view dispatches for `slot`; React Native calls it `topLucent<slot>`. */
export const eventName = (slot: number): string => `lucent${slot}`;

/** The name React Native's view configuration registers for `slot`'s event. */
export const topLevelEvent = (slot: number): string => `topLucent${slot}`;
