/** The internal switch for generating views. */

/**
 * Whether compiles generate components' Fabric sources and React exports:
 * internal, until the view architecture is proven on both platforms. Set
 * with LUCENT_VIEWS=fabric; otherwise components are only described.
 */
export function fabricViews(value = process.env.LUCENT_VIEWS): boolean {
  const problem = viewsSwitchProblem(value);
  if (problem) throw new Error(problem);

  return value === "fabric";
}

/** Why the switch's value is invalid, naming the values it accepts; undefined when it is valid. */
export function viewsSwitchProblem(value = process.env.LUCENT_VIEWS): string | undefined {
  if (!value || value === "fabric") return undefined;

  return `LUCENT_VIEWS must be "fabric" or unset (got "${value}")`;
}

/**
 * fabricViews() for what any compile does, such as resolving lucent:ui: an
 * unexpected value reads as off here, and fails only where components are
 * compiled.
 */
export function fabricRequested(value = process.env.LUCENT_VIEWS): boolean {
  return value === "fabric";
}
