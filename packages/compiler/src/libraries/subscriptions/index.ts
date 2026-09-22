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
  NativeSubscription__create: ["return LucentSubscription()", "return LucentSubscription()"],
  NativeSubscription__get_closed: ["return lucentSelf.closed", "return lucentSelf.closed"],
  NativeSubscription__get_activeCallbackCount: [
    "return lucentSelf.activeCallbackCount",
    "return lucentSelf.activeCallbackCount",
  ],
  NativeSubscription__get_createdAt: ["return lucentSelf.createdAt", "return lucentSelf.createdAt"],
  NativeSubscription__set_createdAt: ["lucentSelf.createdAt = value", "lucentSelf.createdAt = value"],
  NativeSubscription__get_closedAt: ["return lucentSelf.closedAt", "return lucentSelf.closedAt"],
  NativeSubscription__set_closedAt: ["lucentSelf.closedAt = value", "lucentSelf.closedAt = value"],
  NativeSubscription__method_beginDelivery: ["try lucentSelf.beginDelivery()", "lucentSelf.beginDelivery()"],
  NativeSubscription__method_endDelivery: ["lucentSelf.endDelivery()", "lucentSelf.endDelivery()"],
  NativeSubscription__method_close: ["await lucentSelf.close()", "lucentSelf.close()"],
  withSubscription: [
    "try await LucentSubscriptionScope.withSubscription(subscription, body)",
    "LucentSubscriptionScope.withSubscription(subscription, body)",
  ],
} as const;

const bindings: Record<string, NativeBinding> = Object.fromEntries(
  Object.entries(operations).map(([name, [swift, kotlin]]) => [
    name,
    {
      contract: {
        symbolId: nativeSymbolId("Lucent", "NativeSubscription", name, "v1"),
        ...(name === "NativeSubscription__create" ? { result: "owned" as const } : {}),
        ...(name === "withSubscription"
          ? {
              parameters: {
                subscription: { ownership: "retained" as const },
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

export const SUBSCRIPTIONS_LIBRARY: LibraryModule = {
  schemaVersion: 1,
  source: `import type {NativeCallback} from '@lucent-lang/core/types';
export type NativeSubscription={closed:boolean;activeCallbackCount:number;createdAt:string;closedAt:string};
export declare function NativeSubscription__create():NativeSubscription;
export declare function NativeSubscription__get_closed(lucentSelf:NativeSubscription):boolean;
export declare function NativeSubscription__get_activeCallbackCount(lucentSelf:NativeSubscription):number;
export declare function NativeSubscription__get_createdAt(lucentSelf:NativeSubscription):string;
export declare function NativeSubscription__set_createdAt(lucentSelf:NativeSubscription,value:string):void;
export declare function NativeSubscription__get_closedAt(lucentSelf:NativeSubscription):string;
export declare function NativeSubscription__set_closedAt(lucentSelf:NativeSubscription,value:string):void;
export declare function NativeSubscription__method_beginDelivery(lucentSelf:NativeSubscription):void;
export declare function NativeSubscription__method_endDelivery(lucentSelf:NativeSubscription):void;
export declare function NativeSubscription__method_close(lucentSelf:NativeSubscription):Promise<void>;
export declare function withSubscription(subscription:NativeSubscription, body:NativeCallback<(s:NativeSubscription)=>void>):Promise<void>;`,
  references: {
    NativeSubscription: {
      swift: "LucentSubscription",
      kotlin: "LucentSubscription",
      contract: { ownership: "owned", executor: "caller", transferable: true, close: "close" },
    },
  },
  bindings,
  native: {
    swift: { "Subscription.swift": nativeSource("Subscription.swift") },
    kotlin: { "Subscription.kt": nativeSource("Subscription.kt") },
  },
};
