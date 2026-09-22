import { type NativeType, typeToString } from "./native-type.ts";
/** Every source value is exactly representable in these destination types. */
export const NUMERIC_WIDENINGS: Readonly<Record<string, readonly string[]>> = {
  int8: ["int16", "int32", "int64", "float32", "float64"],
  int16: ["int32", "int64", "float32", "float64"],
  int32: ["int64", "float64"],
  uint8: ["uint16", "uint32", "uint64", "int16", "int32", "int64", "float32", "float64"],
  uint16: ["uint32", "uint64", "int32", "int64", "float32", "float64"],
  uint32: ["uint64", "int64", "float64"],
  float32: ["float64"],
};
export function canWidenNumeric(source: NativeType, target: NativeType): boolean {
  return NUMERIC_WIDENINGS[typeToString(source)]?.includes(typeToString(target)) ?? false;
}
