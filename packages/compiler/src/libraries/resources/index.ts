import type { LibraryModule, NativeBinding } from "../../libraries.ts";
import { nativeSymbolId } from "../../native-contracts.ts";
import { nativeSource } from "../../native-sources.generated.ts";

const bodyContract = {
  ownership: "retained" as const,
  callback: {
    retention: "call" as const,
    executor: "caller" as const,
    errors: "propagate" as const,
  },
};

const operations = {
  NativeResource__create: ["return LucentResource()", "return LucentResource()"],
  NativeResource__get_closed: ["return lucentSelf.closed", "return lucentSelf.closed"],
  NativeResource__get_leaseCount: ["return lucentSelf.leaseCount", "return lucentSelf.leaseCount"],
  NativeResource__get_createdAt: ["return lucentSelf.createdAt", "return lucentSelf.createdAt"],
  NativeResource__set_createdAt: ["lucentSelf.createdAt = value", "lucentSelf.createdAt = value"],
  NativeResource__get_closedAt: ["return lucentSelf.closedAt", "return lucentSelf.closedAt"],
  NativeResource__set_closedAt: ["lucentSelf.closedAt = value", "lucentSelf.closedAt = value"],
  NativeResource__method_beginOperation: ["try lucentSelf.beginOperation()", "lucentSelf.beginOperation()"],
  NativeResource__method_endOperation: ["lucentSelf.endOperation()", "lucentSelf.endOperation()"],
  NativeResource__method_close: ["await lucentSelf.close()", "lucentSelf.close()"],
  ResourceScope__create: ["return LucentResourceBag()", "return LucentResourceBag()"],
  ResourceScope__method_own: ["return lucentSelf.own(resource)", "return lucentSelf.own(resource)"],
  ResourceScope__method_closeAll: ["await lucentSelf.closeAll()", "lucentSelf.closeAll()"],
  withResource: [
    "try await LucentResourceScope.withResource(resource, body)",
    "LucentResourceScope.withResource(resource, body)",
  ],
  resourceScope: ["try await LucentResourceScope.resourceScope(body)", "LucentResourceScope.resourceScope(body)"],
} as const;

const bindings: Record<string, NativeBinding> = Object.fromEntries(
  Object.entries(operations).map(([name, [swift, kotlin]]) => [
    name,
    {
      contract: {
        symbolId: nativeSymbolId("Lucent", "NativeResource", name, "v1"),
        ...(name === "NativeResource__create" || name === "ResourceScope__create" ? { result: "owned" as const } : {}),
        ...(name === "ResourceScope__method_own"
          ? {
              result: "owned" as const,
              parameters: {
                lucentSelf: { ownership: "retained" as const },
                resource: { ownership: "retained" as const },
              },
            }
          : {}),
        ...(name === "withResource"
          ? {
              parameters: {
                resource: { ownership: "retained" as const },
                body: bodyContract,
              },
            }
          : {}),
        ...(name === "resourceScope"
          ? {
              parameters: {
                body: bodyContract,
              },
            }
          : {}),
      },
      swift: [swift],
      kotlin: [kotlin],
    },
  ]),
);

export const RESOURCES_LIBRARY: LibraryModule = {
  schemaVersion: 1,
  source: `import type {NativeCallback} from '@lucent-lang/core/types';
export type NativeResource={closed:boolean;leaseCount:number;createdAt:string;closedAt:string};
export type ResourceScope={};
export declare function NativeResource__create():NativeResource;
export declare function NativeResource__get_closed(lucentSelf:NativeResource):boolean;
export declare function NativeResource__get_leaseCount(lucentSelf:NativeResource):number;
export declare function NativeResource__get_createdAt(lucentSelf:NativeResource):string;
export declare function NativeResource__set_createdAt(lucentSelf:NativeResource,value:string):void;
export declare function NativeResource__get_closedAt(lucentSelf:NativeResource):string;
export declare function NativeResource__set_closedAt(lucentSelf:NativeResource,value:string):void;
export declare function NativeResource__method_beginOperation(lucentSelf:NativeResource):void;
export declare function NativeResource__method_endOperation(lucentSelf:NativeResource):void;
export declare function NativeResource__method_close(lucentSelf:NativeResource):Promise<void>;
export declare function ResourceScope__create():ResourceScope;
export declare function ResourceScope__method_own(lucentSelf:ResourceScope, resource:NativeResource):NativeResource;
export declare function ResourceScope__method_closeAll(lucentSelf:ResourceScope):Promise<void>;
export declare function withResource(resource:NativeResource, body:NativeCallback<(r:NativeResource)=>void>):Promise<void>;
export declare function resourceScope(body:NativeCallback<(scope:ResourceScope)=>void>):Promise<void>;`,
  references: {
    NativeResource: {
      swift: "LucentResource",
      kotlin: "LucentResource",
      contract: { ownership: "owned", executor: "caller", transferable: true, close: "close" },
    },
    ResourceScope: {
      swift: "LucentResourceBag",
      kotlin: "LucentResourceBag",
      contract: { ownership: "owned", executor: "caller", transferable: true, close: "closeAll" },
    },
  },
  bindings,
  native: {
    swift: { "Resource.swift": nativeSource("Resource.swift") },
    kotlin: { "Resource.kt": nativeSource("Resource.kt") },
  },
};
