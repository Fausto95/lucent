# lucent-secure-store

[expo-secure-store](https://docs.expo.dev/versions/latest/sdk/securestore/)'
API, written in Lucent as a package: generic passwords in the Keychain on
iOS, and values encrypted with an AES/GCM key from the Android Keystore,
stored in `SharedPreferences`, on Android.

```ts
import { deleteItemAsync, getItemAsync, setItemAsync } from "lucent-secure-store";

await setItemAsync("token", "s3cret");
await getItemAsync("token"); // "s3cret"
await deleteItemAsync("token");
```

## Files

- `src/secureStore.lucent.ts`: the module, `setItemAsync`, `getItemAsync`
  and `deleteItemAsync`.
- `index.ts`: re-exports the module; Metro bundles its proxy.

## What it shows

- **C functions and constants from Security.framework**: `SecItemAdd`,
  `SecItemCopyMatching` with an `Out` for its result, and `kSec*` keys in a
  `Record<string, ObjCValue>` query.
- **Java cryptography**: `KeyGenParameterSpec.Builder`, `KeyStore`,
  `Cipher` and `GCMParameterSpec`, with the key kept in the Keystore.
- The package's page on the website:
  [Secure store](https://lucent-lang.dev/docs/packages/examples/secure-store/).

## Build and check it

Both example apps depend on it, and their Lab's SDK screen runs it beside
expo-secure-store. On its own:

```sh
cd examples/lucent-secure-store
node ../../packages/lucent/bin/lucent.cjs build --platforms host
```

`--platforms host` compiles it without either SDK; with Xcode or the
Android SDK, `lucent build` types each branch.
