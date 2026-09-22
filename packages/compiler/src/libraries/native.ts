import type { LibraryModule } from "../libraries.ts";
/** Byte primitives only. Everything a platform SDK provides belongs in a package manifest. */
export const NATIVE_LIBRARIES: Readonly<Record<string, LibraryModule>> = {
  "@lucent-lang/core": {
    source:
      "export declare function encodeUTF8(text:string):Uint8Array; export declare function decodeUTF8(bytes:Uint8Array):string; export declare function copyBytes(bytes:Uint8Array):Uint8Array;",
    bindings: {
      encodeUTF8: {
        swift: ["return try LucentBytes.fromData(Data(text.utf8))"],
        kotlin: ["return LucentBytes.fromByteArray(text.toByteArray(Charsets.UTF_8))"],
        swiftImports: ["Foundation"],
      },
      decodeUTF8: {
        swift: ["return String(decoding: LucentBytes.data(bytes), as: UTF8.self)"],
        kotlin: ["return LucentBytes.toByteArray(bytes).toString(Charsets.UTF_8)"],
      },
      copyBytes: {
        swift: ["return try LucentBytes.fromData(LucentBytes.data(bytes))"],
        kotlin: ["return LucentBytes.fromByteArray(LucentBytes.toByteArray(bytes))"],
      },
    },
  },
};
