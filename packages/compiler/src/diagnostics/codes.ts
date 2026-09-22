/** Every diagnostic Lucent can emit. The table is the single source of truth for codes and titles. */
export const DIAGNOSTIC_CODES = {
  LUCENT2001: "Missing native capability",
  LUCENT2004: "Platform-specific API",
  LUCENT3002: "Potentially expensive main-thread work",
  LUCENT1000: "Syntax error",
  LUCENT1001: "Unsupported syntax",
  LUCENT1002: "Dynamic property access",
  LUCENT1003: "Unsupported type",
  LUCENT1004: "`any` is prohibited",
  LUCENT1005: "Function cannot cross the native boundary",
  LUCENT1006: "Unsupported dependency",
  LUCENT1007: "Too many parameters",
  LUCENT1010: "Unknown identifier",
  LUCENT1011: "Type mismatch",
  LUCENT1012: "Wrong number of arguments",
  LUCENT1013: "`await` outside an async function",
  LUCENT1014: "Missing type annotation",
  LUCENT1015: "Missing return",
  LUCENT1016: "Assignment to a constant",
  LUCENT1018: "Borrowed value escapes",
  LUCENT1019: "Wrong executor",
} as const;

export type DiagnosticCode = keyof typeof DIAGNOSTIC_CODES;
