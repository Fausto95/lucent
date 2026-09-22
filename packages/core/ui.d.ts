import type { ReactElement, ReactNode } from "react";
import type { ViewProps } from "react-native";
import type { Event } from "@lucent-lang/core/events";
/** Compiled to SwiftUI/Compose by Lucent. These declarations have no JS runtime. */
export type NativeView = ReactElement;
/** React Native host layout props are applied by React, not read by the native render function. */
export type NativeProps<P> = P & ViewProps;
type LayoutProps = { padding?: number; spacing?: number; children?: ReactNode };
export declare function VStack(props: LayoutProps): NativeView;
export declare function HStack(props: LayoutProps): NativeView;
export declare function Text(props: { size?: number; color?: string; children?: ReactNode }): NativeView;
export declare function Spacer(props: { size?: number }): NativeView;
export declare function Button(props: { title: string; onPress?: Event<void> }): NativeView;
export declare function TextField(props: { value: string; placeholder?: string; onChange: Event<string> }): NativeView;
export declare function Toggle(props: { value: boolean; title: string; onChange: Event<boolean> }): NativeView;
export declare function Slider(props: {
  value: number;
  min?: number;
  max?: number;
  onChange: Event<number>;
}): NativeView;
export declare function ScrollView(props: { children?: ReactNode }): NativeView;
export declare function ZStack(props: { children?: ReactNode }): NativeView;
export declare function Padding(props: { value: number; children?: ReactNode }): NativeView;
export declare function Background(props: { color: string; children?: ReactNode }): NativeView;
export declare function CornerRadius(props: { value: number; children?: ReactNode }): NativeView;
export declare function Accessibility(props: { label: string; children?: ReactNode }): NativeView;
export declare function Divider(props?: Record<string, never>): NativeView;
export declare function For<T>(props: {
  each: T[];
  by?: (item: T) => string;
  children: (item: T) => NativeView;
}): NativeView;

/** Native scalar state; values are read directly and written with set(). */
type StateValue<T> = T extends string ? string : T extends number ? number : boolean;
declare global {
  function state<T extends string | number | boolean>(initial: T): StateValue<T> & { set(value: StateValue<T>): void };
  /** Component-owned resource; created once per host identity and closed on unmount. */
  function resource<T>(factory: () => T): T;
  /** Sync component effect. Cleanup runs before unmount; deps identity is recorded for later async work. */
  function effect(body: () => void | (() => void), deps: readonly unknown[]): void;
}
