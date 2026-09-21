export declare function read(path: string): Promise<Uint8Array>;
export declare function write(path: string, bytes: Uint8Array): Promise<void>;
export declare function exists(path: string): Promise<boolean>;
export declare function temporaryDirectory(): Promise<string>;
