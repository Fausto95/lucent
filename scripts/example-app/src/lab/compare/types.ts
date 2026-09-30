/** What every module in the comparison implements, natively. */
export interface AddModule {
  addNumbers(a: number, b: number): number;
  addStrings(a: string, b: string): string;
}

export interface CompareModule {
  name: string;
  /** The module, or null when the native build does not link it. */
  load: () => AddModule | null;
}
