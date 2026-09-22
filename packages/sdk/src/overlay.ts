/**
 * Semantic overlay validation (P65). Overlays describe ownership, executor,
 * cancellation, and callback retention that extraction cannot infer reliably.
 */

const EXECUTORS = new Set(["caller", "main", "worker", "serial"]);
const OWNERSHIPS = new Set(["owned", "external"]);
const RETENTIONS = new Set(["call", "subscription"]);
const ERRORS = new Set(["propagate", "notify"]);
const BACKPRESSURE = new Set(["latest", "dropOldest", "dropNewest", "block"]);
const CANCELLATIONS = new Set(["none", "cooperative"]);

export interface LucentOverlayObject {
  ownership: "owned" | "external";
  executor: string;
  transferable?: boolean;
  close?: string;
  cancellation?: "none" | "cooperative";
}

export interface LucentOverlayCallback {
  retention: "call" | "subscription";
  executor: string;
  errors: "propagate" | "notify";
  backpressure?: string;
  remove?: string;
}

export interface LucentOverlay {
  schemaVersion: 1;
  package: string;
  objects?: Record<string, LucentOverlayObject>;
  callbacks?: Record<string, LucentOverlayCallback>;
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/**
 * Validate overlay shape. Rejects retention mismatches such as `call` with
 * subscription-only fields (backpressure / remove), or unknown enum values.
 */
export function validateOverlay(overlay: unknown): string[] {
  const errors: string[] = [];
  if (!record(overlay)) return ["Overlay must be an object."];
  if (overlay.schemaVersion !== 1) errors.push("Unsupported overlay schemaVersion.");
  if (typeof overlay.package !== "string" || !overlay.package.trim())
    errors.push("Overlay package must be a non-empty string.");

  if (overlay.objects !== undefined) {
    if (!record(overlay.objects)) errors.push("Overlay objects must be a map.");
    else
      for (const [name, object] of Object.entries(overlay.objects)) {
        if (!record(object)) {
          errors.push(`Invalid overlay object ${name}.`);
          continue;
        }
        if (!OWNERSHIPS.has(String(object.ownership))) errors.push(`Invalid ownership for ${name}.`);
        if (!EXECUTORS.has(String(object.executor))) errors.push(`Invalid executor for ${name}.`);
        if (object.transferable !== undefined && typeof object.transferable !== "boolean")
          errors.push(`Invalid transferable for ${name}.`);
        if (object.close !== undefined && (typeof object.close !== "string" || !object.close))
          errors.push(`Invalid close for ${name}.`);
        if (object.cancellation !== undefined && !CANCELLATIONS.has(String(object.cancellation)))
          errors.push(`Invalid cancellation for ${name}.`);
      }
  }

  if (overlay.callbacks !== undefined) {
    if (!record(overlay.callbacks)) errors.push("Overlay callbacks must be a map.");
    else
      for (const [name, callback] of Object.entries(overlay.callbacks)) {
        if (!record(callback)) {
          errors.push(`Invalid overlay callback ${name}.`);
          continue;
        }
        if (!RETENTIONS.has(String(callback.retention))) errors.push(`Invalid retention for ${name}.`);
        if (!EXECUTORS.has(String(callback.executor))) errors.push(`Invalid callback executor for ${name}.`);
        if (!ERRORS.has(String(callback.errors))) errors.push(`Invalid callback errors for ${name}.`);
        if (callback.backpressure !== undefined && !BACKPRESSURE.has(String(callback.backpressure)))
          errors.push(`Invalid backpressure for ${name}.`);
        if (callback.remove !== undefined && (typeof callback.remove !== "string" || !callback.remove))
          errors.push(`Invalid remove for ${name}.`);
        // Retention mismatch shapes: call retention cannot declare subscription fields.
        if (callback.retention === "call" && callback.backpressure !== undefined)
          errors.push(`Retention mismatch for ${name}: call retention cannot declare backpressure.`);
        if (callback.retention === "call" && callback.remove !== undefined)
          errors.push(`Retention mismatch for ${name}: call retention cannot declare remove.`);
      }
  }

  return errors;
}
