/** Every diagnostic Lucent can emit. The table is the single source of truth for codes and titles. */
export const DIAGNOSTIC_CODES = {
  NT2001: "Missing native capability",
  NT2004: "Platform-specific API",
  NT3002: "Potentially expensive main-thread work",
  NT1000: "Syntax error",
  NT1001: "Unsupported syntax",
  NT1002: "Dynamic property access",
  NT1003: "Unsupported type",
  NT1004: "`any` is prohibited",
  NT1005: "Function cannot cross the native boundary",
  NT1006: "Unsupported dependency",
  NT1007: "Too many parameters",
  NT1010: "Unknown identifier",
  NT1011: "Type mismatch",
  NT1012: "Wrong number of arguments",
  NT1013: "`await` outside an async function",
  NT1014: "Missing type annotation",
  NT1015: "Missing return",
  NT1016: "Assignment to a constant",
} as const;

export type DiagnosticCode = keyof typeof DIAGNOSTIC_CODES;
