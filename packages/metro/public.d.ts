export type HostName = "expo" | "nitro";
export interface LucentMetroOptions {
  host?: HostName;
}
interface MetroLikeConfig {
  transformer?: { babelTransformerPath?: string; [key: string]: unknown };
  [key: string]: unknown;
}
export declare function transformerPath(): string;
export declare function withLucent<C extends MetroLikeConfig>(config: C, options?: LucentMetroOptions): C;
