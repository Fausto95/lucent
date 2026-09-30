export type SdkCase = {
  name: string;
  run: () => Promise<string>;
  /** The result on this platform. */
  expected: string | RegExp;
};
