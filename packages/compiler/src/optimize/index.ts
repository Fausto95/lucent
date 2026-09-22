import type { IRModule } from "../ir/types.ts";
import { validateHIR } from "../ir/validate.ts";
import { constantFold } from "./passes/constant-fold.ts";
import { deadBranchEliminate } from "./passes/dead-branch.ts";
import { deadCodeEliminate } from "./passes/dce.ts";
import { escapeAnalyze } from "./passes/escape-analysis.ts";
import { reachabilityEliminate } from "./passes/reachability.ts";

export interface OptimizeOptions {
  /** When false or omitted, return the module unchanged. */
  enabled?: boolean;
}

export interface OptimizeResult {
  module: IRModule;
  log: string[];
}

/**
 * Optional semantic optimization on HIR. Each pass re-validates; a failed
 * validation rolls that pass back and records the failure in the log.
 * Escape-analysis is log-only. Reachability removes proven-unreachable
 * non-exported functions.
 */
export function optimizeModule(module: IRModule, options?: OptimizeOptions): OptimizeResult {
  if (!options?.enabled) return { module, log: [] };

  const log: string[] = [];
  let current = module;

  const fold = constantFold(current);
  const foldDiag = validateHIR(fold.module);
  if (foldDiag.length) {
    log.push(`constant-fold: validation failed (${foldDiag.length}), keeping prior module`);
  } else {
    current = fold.module;
    log.push(`constant-fold: folded ${fold.folded} binary op(s)`);
  }

  const branch = deadBranchEliminate(current);
  const branchDiag = validateHIR(branch.module);
  if (branchDiag.length) {
    log.push(`dead-branch: validation failed (${branchDiag.length}), keeping prior module`);
  } else {
    current = branch.module;
    log.push(`dead-branch: eliminated ${branch.eliminated} const branch(es)`);
  }

  const dce = deadCodeEliminate(current);
  const dceDiag = validateHIR(dce.module);
  if (dceDiag.length) {
    log.push(`dce: validation failed (${dceDiag.length}), keeping prior module`);
  } else {
    current = dce.module;
    log.push(`dce: removed ${dce.removed} pure const expr stmt(s)`);
  }

  const escape = escapeAnalyze(current);
  log.push(...escape.log);

  const reachability = reachabilityEliminate(current);
  const reachDiag = validateHIR(reachability.module);
  if (reachDiag.length) {
    log.push(`reachability: validation failed (${reachDiag.length}), keeping prior module`);
  } else {
    current = reachability.module;
    log.push(...reachability.log);
    if (reachability.removed === 0 && reachability.unreachable.length === 0) {
      log.push("reachability: no unreachable non-exported functions");
    }
  }

  return { module: current, log };
}
