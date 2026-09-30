/** The internal switch for generating views. */

/**
 * Whether compiles generate components' Fabric sources and React exports:
 * internal, until the view architecture is proven on both platforms. Set
 * with LUCENT_VIEWS=fabric; otherwise components are only described.
 */
export function fabricViews(value = process.env.LUCENT_VIEWS): boolean {
  if (!value) return false;

  if (value !== "fabric")
    throw new Error(`LUCENT_VIEWS must be "fabric" when set (got "${value}")`);

  return true;
}

/**
 * fabricViews() for what any compile does, such as resolving lucent:ui: an
 * unexpected value reads as off here, and fails only where components are
 * compiled.
 */
export function fabricRequested(value = process.env.LUCENT_VIEWS): boolean {
  return value === "fabric";
}
