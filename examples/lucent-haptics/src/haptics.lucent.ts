// expo-haptics' API, implemented in Lucent per platform (the M2.0 parity port).
import type { ImpactFeedbackStyle, NotificationFeedbackType } from "./hapticsTypes.lucent";

export declare function impactAsync(style?: ImpactFeedbackStyle): Promise<void>;
export declare function notificationAsync(type?: NotificationFeedbackType): Promise<void>;
export declare function selectionAsync(): Promise<void>;
