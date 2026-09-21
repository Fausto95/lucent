import type { ReactElement, ReactNode } from "react";
import type { ViewProps } from "react-native";
import type { Event } from "@lucent-lang/events";
/** Compiled to SwiftUI/Compose by Lucent. These declarations have no JS runtime. */
export type NativeView = ReactElement;
/** React Native host layout props are applied by React, not read by the native render function. */
export type NativeProps<P> = P & ViewProps;
type LayoutProps = { padding?: number; spacing?: number; children?: ReactNode };
export declare function Column(props: LayoutProps): NativeView;
export declare function Row(props: LayoutProps): NativeView;
export declare function Text(props: { size?: number; color?: string; children?: ReactNode }): NativeView;
export declare function Spacer(props: { size?: number }): NativeView;
export declare function Button(props: { title: string; onPress?: Event<void> }): NativeView;
