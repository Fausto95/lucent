import { nativeSwift } from "./native.ts";

/** A host-neutral error envelope; hex protects Unicode/newlines from host decoration. */
export const swiftErrorWire = nativeSwift("LucentErrorWire.swift");
