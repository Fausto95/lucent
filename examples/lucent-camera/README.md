# lucent-camera

Camera permission and photo capture, written in Lucent: one module that
runs an `AVCaptureSession` on iOS and CameraX's `ImageCapture` on Android,
and saves each photo as a JPEG in the app's cache directory.

```ts
import { close, open, requestPermission, takePhoto } from "lucent-camera";

if ((await requestPermission()) === "granted") {
  await open("back");
  try {
    const photo = await takePhoto();
    console.log(photo.path, photo.bytes); // show it with <Image source={{ uri: `file://${photo.path}` }} />
  } finally {
    await close();
  }
}
```

The module has no preview: it opens the camera, takes photos and closes
it. A preview is a native view, which [native views](https://lucent-lang.dev/docs/guides/views/)
can render from the same session, in preview.

## Files

- `src/camera.lucent.ts`: `getPermission()`, `requestPermission()`,
  `open(facing)`, `takePhoto()` and `close()`.
- `lucent.json`: iOS links AVFoundation and adds `NSCameraUsageDescription`
  to `Info.plist` (Expo's config plugin writes it; a bare app is told to);
  Android declares `android.permission.CAMERA` and depends on CameraX 1.3.

## What it shows

- **The permission flow.** iOS reads `AVCaptureDevice.authorizationStatus`
  and awaits `requestAccess(for:)`, a completion handler Lucent turns into
  a promise. Android checks `checkSelfPermission` and asks with
  `requestPermissions()` from `lucent:android`, which shows the dialog
  from the Activity in front. `open()` rejects with `E_CAMERA_PERMISSION`
  until the person allows it.
- **A delegate that outlives the call.** `AVCapturePhotoOutput` holds its
  delegate weakly, so the module keeps each `Shot` in a set until its
  `photoOutput(_:didFinishProcessingPhoto:error:)` runs, then resolves the
  promise through `fromCallback()`.
- **A Gradle library bound by rule.** CameraX's `ProcessCameraProvider`,
  `ImageCapture` and its builders come from the Gradle dependencies in
  `lucent.json`, bound like the SDK. Its `ListenableFuture` and its
  `OnImageSavedCallback` are adapted into promises; nothing in Lucent
  names CameraX.
- **The main thread where the SDK needs it.** CameraX binds to a
  lifecycle on the main thread, inside `main(() => …)`. iOS's
  `startRunning()` blocks until the camera starts, so it runs on the
  Lucent thread, in the `async` export.
- **Files, not bytes.** A photo's bytes stay native: JavaScript gets the
  file's path.

## Build and check it

```sh
pnpm install && pnpm build                       # at the repository root
cd examples/lucent-camera
node ../../packages/lucent/bin/lucent.cjs build --platforms host
```

`--platforms host` compiles the module without either SDK: platform code
is untyped and becomes stubs that throw. In an app with an `android/`
project, `lucent build` resolves CameraX through Gradle and types the
Android branch; on a Mac, Xcode types the iOS one. The iOS simulator has
no camera: `open()` rejects with `E_CAMERA_UNAVAILABLE` there.

Compiled with `--platforms host` on Linux. Not yet typed against the SDKs
or CameraX, or run on a device.
