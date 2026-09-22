declare module "@lucent-lang/example-text" {
  export class NativeText {
    constructor(value: string);
    readonly length: number;
    dispose(): void;
  }
}
