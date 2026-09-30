// Platform modules calling the iOS and Android SDKs (M2.0). They run only on
// devices and simulators; the Hermes host has stubs of them.
import NetInfo from "@react-native-community/netinfo";
import { Platform } from "react-native";
import * as Application from "../../sdk/application.lucent";
import { mainThreadCallback } from "../../sdk/callbacks.lucent";
import * as Clipboard from "../../sdk/clipboard.lucent";
import * as Device from "../../sdk/device.lucent";
import * as LocalAuthentication from "../../sdk/localAuthentication.lucent";
import * as Location from "../../sdk/location.lucent";
import * as NetInfoPort from "../../sdk/netInfo.lucent";
import * as Presentation from "../../sdk/presentation.lucent";
// Ports shipped as Lucent packages (examples/), installed like any npm package.
import {
  ImpactFeedbackStyle,
  impactAsync,
  NotificationFeedbackType,
  notificationAsync,
  selectionAsync,
} from "lucent-haptics";
import { parityCases } from "./parity";
import { errorCode, identity, systemName, usingCursor } from "../../sdk/probe.lucent";
import * as Orbit from "lucent-orbit";
import * as SecureStore from "lucent-secure-store";
import * as Storage from "../../sdk/storage.lucent";
import * as Swift from "../../sdk/swift.lucent";
import type { SdkCase } from "./types";

const ios = Platform.OS === "ios";
const done = (p: Promise<void>) => p.then(() => "ok");
/** A promise that fails after `ms`, so a position that never comes fails the case. */
const within = <T>(ms: number, p: Promise<T>) =>
  Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms)),
  ]);
const TYPE = /^(wifi|cellular|ethernet|none|unknown|vpn|bluetooth) (true|false)$/;
/** What both netinfo implementations report, for comparing them. */
const netShape = (s: { type: string; isConnected: boolean | null; details: unknown }) =>
  JSON.stringify([
    s.type,
    s.isConnected,
    (s.details as { isConnectionExpensive?: boolean } | null)?.isConnectionExpensive ?? null,
  ]);
/** A position to two decimals; where it is depends on the device (parity cases compare with the original). */
const place = (l: { coords: { latitude: number; longitude: number } }) =>
  `${l.coords.latitude.toFixed(2)},${l.coords.longitude.toFixed(2)}`;

export const sdkCases: SdkCase[] = [
  { name: "haptics.impactAsync()", run: () => done(impactAsync()), expected: "ok" },
  {
    name: "haptics.impactAsync(Heavy)",
    run: () => done(impactAsync(ImpactFeedbackStyle.Heavy)),
    expected: "ok",
  },
  {
    name: "haptics.notificationAsync(Error)",
    run: () => done(notificationAsync(NotificationFeedbackType.Error)),
    expected: "ok",
  },
  { name: "haptics.selectionAsync()", run: () => done(selectionAsync()), expected: "ok" },
  { name: "probe.systemName()", run: systemName, expected: ios ? "iOS" : /^Android \d+/ },
  { name: "probe.identity()", run: identity, expected: ios ? "true" : "false|true" },
  {
    name: "probe.errorCode()",
    run: errorCode,
    expected: ios ? "none" : "java.lang.IllegalArgumentException",
  },
  { name: "probe.usingCursor()", run: usingCursor, expected: ios ? "none" : "0 true" },
  {
    name: "callbacks: the platform calls Lucent back",
    run: mainThreadCallback,
    expected: "called back",
  },
  // The app's lifecycle, and view controllers presented from the scene in use.
  {
    name: "lifecycle: follow the app and its scenes",
    run: Presentation.followLifecycle,
    expected: ios ? "following" : "none",
  },
  {
    name: "lifecycle: an app event until stopped",
    run: Presentation.appEventUntilStopped,
    expected: ios ? "1" : "none",
  },
  {
    name: "presentation: withdrawn by a signal",
    run: Presentation.withdrawnBySignal,
    expected: ios ? "true AbortError false" : "none",
  },
  {
    name: "presentation: resolved by the page, then dismissed",
    run: Presentation.resolvedThenDismissed,
    expected: ios ? "closed false" : "none",
  },
  {
    name: "presentation: a Lucent UIViewController subclass",
    run: Presentation.subclassPresented,
    expected: ios ? "appeared 1 1 Lucent false" : "none",
  },
  {
    name: "presentation: share sheet withdrawn by a signal",
    run: Presentation.shareSheetWithdrawn,
    expected: ios ? "true AbortError false" : "none",
  },
  // M2.1 parity ports.
  {
    name: "clipboard: set, get, has",
    run: async () =>
      `${await Clipboard.setStringAsync("lucent ✓")} ${await Clipboard.getStringAsync()} ${await Clipboard.hasStringAsync()}`,
    expected: "true lucent ✓ true",
  },
  {
    name: "application: id, versions",
    run: async () =>
      `${Application.applicationId()} ${Application.nativeApplicationVersion()} ${Application.nativeBuildVersion()}`,
    expected: /^[\w.]*example\w* 1\.0(\.0)? 1$/i,
  },
  {
    name: "application: installation time",
    run: async () => {
      const t = (await Application.getInstallationTimeAsync()).getTime();
      return t > Date.UTC(2020, 0, 1) && t <= Date.now() ? "in the past" : `bad: ${t}`;
    },
    expected: "in the past",
  },
  {
    name: "device: OS and memory",
    run: async () => {
      const d = await Device.getDeviceInfoAsync();
      return `${d.osName} ${!!d.osVersion} ${!!d.manufacturer} ${(d.totalMemory ?? 0) > 0}`;
    },
    expected: ios ? "iOS true true true" : "Android true true true",
  },
  {
    name: "async-storage: set, multiSet, remove, keys, multiGet",
    run: async () => {
      await Storage.clear();
      await Storage.setItem("a", "1");
      await Storage.multiSet([
        ["b", "2"],
        ["c", "3"],
      ]);
      await Storage.removeItem("c");
      const keys = (await Storage.getAllKeys()).sort();
      return `${JSON.stringify(keys)} ${JSON.stringify(await Storage.multiGet(["a", "b", "c"]))} ${await Storage.getItem("b")}`;
    },
    expected: '["a","b"] [["a","1"],["b","2"],["c",null]] 2',
  },
  {
    name: "secure-store: set, update, get, delete",
    run: async () => {
      await SecureStore.setItemAsync("token", "first");
      await SecureStore.setItemAsync("token", "s3cr3t ✓");
      const value = await SecureStore.getItemAsync("token");
      await SecureStore.deleteItemAsync("token");
      return `${value} ${await SecureStore.getItemAsync("token")}`;
    },
    expected: "s3cr3t ✓ null",
  },
  {
    name: "local-authentication: hardware, enrollment, level",
    run: async () =>
      `${await LocalAuthentication.hasHardwareAsync()} ${await LocalAuthentication.isEnrolledAsync()} [${await LocalAuthentication.supportedAuthenticationTypesAsync()}] ${await LocalAuthentication.getEnrolledLevelAsync()}`,
    expected: /^(true|false) (true|false) \[[1-3,]*\] [0-3]$/,
  },
  {
    // Biometrics only: without enrollment it fails at once, with no prompt.
    name: "local-authentication: authenticate without enrolled biometrics",
    run: async () => {
      const r = await LocalAuthentication.authenticateAsync({
        promptMessage: "Lucent",
        disableDeviceFallback: true,
      });
      return `${r.success} ${r.error}`;
    },
    expected: /^false (not_enrolled|missing_usage_description|not_available)$/,
  },
  {
    name: "location: services and permission",
    run: async () =>
      `${await Location.hasServicesEnabledAsync()} ${(await Location.getForegroundPermissionsAsync()).status}`,
    expected: /^(true|false) (granted|denied|undetermined)$/,
  },
  {
    name: "location: current position (a delegate / a listener)",
    run: async () => place(await within(15000, Location.getCurrentPositionAsync())),
    expected: /^-?\d+\.\d\d,-?\d+\.\d\d$/,
  },
  {
    name: "location: watch position until stopped",
    run: async () => {
      let stop = () => {};
      const first = new Promise<string>((resolve) => {
        void Location.watchPositionAsync((l) => resolve(place(l))).then(
          (id) => (stop = () => void Location.stopWatching(id)),
        );
      });
      const result = await within(15000, first);
      stop();
      return result;
    },
    expected: /^-?\d+\.\d\d,-?\d+\.\d\d$/,
  },
  {
    name: "netinfo: fetch",
    run: async () => {
      const s = await NetInfoPort.fetch();
      return `${s.type} ${s.isConnected}`;
    },
    expected: TYPE,
  },
  {
    name: "netinfo: listener until removed (a block / a NetworkCallback)",
    run: async () => {
      let first: (s: string) => void = () => {};
      const firstState = new Promise<string>((resolve) => (first = resolve));
      const id = await NetInfoPort.addEventListener((s) => first(`${s.type} ${s.isConnected}`));
      const result = await within(10000, firstState);
      await NetInfoPort.removeEventListener(id);
      return result;
    },
    expected: TYPE,
  },
  {
    name: "same as @react-native-community/netinfo",
    run: async () => {
      const [a, b] = [netShape(await NetInfoPort.fetch()), netShape(await NetInfo.fetch())];
      return a === b ? `same ${a}` : `lucent ${a} netinfo ${b}`;
    },
    expected: /^same /,
  },
  // Swift-only iOS APIs, through generated shims.
  {
    name: "swift: SHA256.hash (CryptoKit)",
    run: () => Swift.sha256("abc"),
    // The FIPS 180-2 test vector.
    expected: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  },
  {
    name: "swift: AES.GCM seal, open (CryptoKit)",
    run: () => Swift.aesRoundTrip("lucent"),
    expected: ios ? "6 16 true" : "n/a",
  },
  {
    name: "swift: P256 sign, verify (CryptoKit)",
    run: Swift.p256,
    expected: ios ? "true false" : "n/a",
  },
  {
    name: "swift: Product.products, Transaction.latest (StoreKit 2)",
    run: Swift.store,
    expected: ios ? /^\d+ (none|verified|unverified)$/ : "n/a",
  },
  {
    name: "swift: AVURLAsset.load(.duration) (AVFoundation)",
    run: Swift.mediaDuration,
    expected: ios ? "1" : "n/a",
  },
  // A Kotlin library (lucent-orbit's), through generated Kotlin shims (Android).
  {
    name: "kotlin: a suspend function, its default left out",
    run: () => Orbit.searchTitles("or"),
    expected: ios ? "no Kotlin on iOS" : "orbit orange",
  },
  {
    name: "kotlin: a suspend call cancelled by its signal",
    run: Orbit.cancelledSearch,
    expected: ios ? "no Kotlin on iOS" : "AbortError true",
  },
  {
    name: "kotlin: an exception rejects the promise",
    run: Orbit.failedSearch,
    expected: ios ? "no Kotlin on iOS" : "java.lang.IllegalArgumentException: bad query: !",
  },
  {
    name: "kotlin: a late result after cancelling is dropped",
    run: Orbit.lateResult,
    expected: ios ? "no Kotlin on iOS" : "rejected late 5",
  },
  {
    name: "kotlin: defaults left out, null passed, a setter",
    run: Orbit.defaults,
    expected: ios ? "no Kotlin on iOS" : "search:named find:named find named 1",
  },
  {
    name: "kotlin: value classes, sealed cases, extensions, top-level declarations",
    run: Orbit.shapes,
    expected: ios ? "no Kotlin on iOS" : "6.56 6 2 ft circle 2",
  },
  {
    name: "kotlin: Longs beyond 2^53 as bigints, a value class over one",
    run: Orbit.ids,
    expected: ios
      ? "no Kotlin on iOS"
      : "9007199254740995 9007199254740994 4620693217682128897 true RangeError",
  },
  // Kotlin collections and flows (lucent-orbit's library).
  {
    name: "kotlin: a read-only list is a copy, a mutable list itself",
    run: Orbit.listCopies,
    expected: ios ? "no Kotlin on iOS" : "orbit,ocean,mine orbit,ocean,planet 3 true",
  },
  {
    name: "kotlin: list elements, boxed, null, nested, and arrays",
    run: Orbit.listElements,
    expected: ios ? "no Kotlin on iOS" : "1,2 a,,bb orbit+ocean/origin 1,2 3.5 x - y a",
  },
  {
    name: "kotlin: a null element Kotlin says cannot be",
    run: Orbit.listNull,
    expected: ios ? "no Kotlin on iOS" : "TypeError",
  },
  {
    name: "kotlin: a flow collected, first() and toList()",
    run: Orbit.flowValues,
    expected: ios ? "no Kotlin on iOS" : "1,2,3 1 4",
  },
  {
    name: "kotlin: a flow's error, a collector's own error",
    run: Orbit.flowErrors,
    expected: ios ? "no Kotlin on iOS" : "one | broken after one | RangeError: stop at 2",
  },
  {
    name: "kotlin: a flow cancelled by its signal stops",
    run: Orbit.flowCancel,
    expected: ios ? "no Kotlin on iOS" : "AbortError 3 true 1",
  },
  {
    name: "kotlin: a StateFlow's value, then its changes",
    run: Orbit.flowState,
    expected: ios ? "no Kotlin on iOS" : "idle,busy,done AbortError",
  },
  {
    name: "kotlin: a flow as a subscription, cancelled by its cleanup",
    run: Orbit.flowSubscribed,
    expected: ios ? "no Kotlin on iOS" : "1,2,3 AbortError 3 1",
  },
  {
    name: "kotlin: Lucent functions as suspend function arguments",
    run: Orbit.suspendArguments,
    expected: ios ? "no Kotlin on iOS" : "3 abc ORBIT",
  },
  // Jetpack ports (lucent-orbit), through the same bindings.
  {
    name: "datastore: edit in a transaction, read the data flow",
    run: Orbit.preferencesEdit,
    expected: ios ? "no DataStore on iOS" : "1 true 1 true",
  },
  {
    name: "datastore: a transaction that throws writes nothing",
    run: Orbit.preferencesRollback,
    expected: ios ? "no DataStore on iOS" : "RangeError: no more visits 1",
  },
  {
    name: "datastore: the data flow sees an edit, until cancelled",
    run: Orbit.preferencesFlow,
    expected: ios ? "no DataStore on iOS" : "light,dark AbortError",
  },
  {
    name: "credentials: requests with Kotlin's defaults",
    run: Orbit.credentialRequests,
    expected: ios
      ? "no Credential Manager on iOS"
      : "1 true true false true null true ada ada true",
  },
  {
    name: "credentials: a password lookup the system answers",
    run: Orbit.credentialLookup,
    expected: ios ? "no Credential Manager on iOS" : "a GetCredentialException",
  },
  ...parityCases,
];
