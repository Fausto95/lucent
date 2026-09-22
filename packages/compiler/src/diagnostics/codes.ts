/** Every diagnostic Lucent can emit. The table is the single source of truth for codes and titles. */
export const DIAGNOSTIC_CODES = {
  LC2001: "Missing native capability",
  LC2004: "Platform-specific API",
  LC3002: "Potentially expensive main-thread work",
  LC1000: "Syntax error",
  LC1001: "Unsupported syntax",
  LC1002: "Dynamic property access",
  LC1003: "Unsupported type",
  LC1004: "`any` is prohibited",
  LC1005: "Function cannot cross the native boundary",
  LC1006: "Unsupported dependency",
  LC1007: "Too many parameters",
  LC1010: "Unknown identifier",
  LC1011: "Type mismatch",
  LC1012: "Wrong number of arguments",
  LC1013: "`await` outside an async function",
  LC1014: "Missing type annotation",
  LC1015: "Missing return",
  LC1016: "Assignment to a constant",
  LC1018: "Borrowed value escapes",
  LC1019: "Wrong executor",
} as const;

export type DiagnosticCode = keyof typeof DIAGNOSTIC_CODES;
