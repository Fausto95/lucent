// Camera permission and photo capture, with no preview: open the camera,
// take photos, close it. iOS runs an AVCaptureSession with an
// AVCapturePhotoOutput, whose delegate receives each photo; Android binds
// CameraX's ImageCapture to the Activity in front, which saves each photo
// itself. Photos are JPEG files in the app's cache directory, returned as
// paths: their bytes never cross to JavaScript.
import { delay, error, fromCallback } from "lucent:core";
import { PLATFORM } from "lucent:platform";
import { main } from "lucent:thread";
import {
  AVAuthorizationStatus,
  AVCaptureDevice,
  AVCaptureDevice_DeviceType,
  AVCaptureDevice_Position,
  AVCaptureDeviceInput,
  AVCaptureSession,
  AVCaptureSession_Preset,
  AVCapturePhoto,
  type AVCapturePhotoCaptureDelegate,
  AVCapturePhotoOutput,
  AVCapturePhotoSettings,
  AVMediaType,
} from "lucent:ios/AVFoundation";
import { FileManager, NSTemporaryDirectory } from "lucent:ios/Foundation";
import { appContext, currentActivity, requestPermissions } from "lucent:android";
import { PackageManager } from "lucent:android/android.content.pm";
import { ComponentActivity } from "lucent:android/androidx.activity";
import {
  CameraSelector,
  ImageCapture,
  ImageCapture_Builder,
  type ImageCapture_OnImageSavedCallback,
  ImageCapture_OutputFileOptions_Builder,
  ImageCapture_OutputFileResults,
  ImageCaptureException,
} from "lucent:android/androidx.camera.core";
import { ProcessCameraProvider } from "lucent:android/androidx.camera.lifecycle";
import type { ListenableFuture } from "lucent:android/com.google.common.util.concurrent";
import { File } from "lucent:android/java.io";
import type { Runnable } from "lucent:android/java.lang";

export type Permission = "granted" | "denied" | "undetermined";

export type Facing = "back" | "front";

export type Photo = { path: string; bytes: number; takenAt: number };

let shots = 0;
const fileName = () => `lucent-camera-${Date.now()}-${shots++}.jpg`;

// --- iOS: AVFoundation -------------------------------------------------------

// The open session, and its photo output: one camera at a time.
let session: AVCaptureSession | null = null;
let output: AVCapturePhotoOutput | null = null;

function iosPermission(): Permission {
  const status = AVCaptureDevice.authorizationStatus(AVMediaType.video);
  if (status === AVAuthorizationStatus.authorized) return "granted";
  if (status === AVAuthorizationStatus.notDetermined) return "undetermined";
  return "denied"; // denied, or restricted by parental controls or MDM
}

async function iosOpen(facing: Facing): Promise<void> {
  const position =
    facing === "back" ? AVCaptureDevice_Position.back : AVCaptureDevice_Position.front;
  const wide = AVCaptureDevice_DeviceType.builtInWideAngleCamera;
  const device = AVCaptureDevice.default(wide, AVMediaType.video, position);
  if (!device) throw error("E_CAMERA_UNAVAILABLE", `this device has no ${facing} camera`);

  const capture = new AVCaptureSession();
  capture.sessionPreset = AVCaptureSession_Preset.photo;
  const input = new AVCaptureDeviceInput(device); // throws when the camera is busy or not allowed
  const photos = new AVCapturePhotoOutput();
  if (!capture.canAddInput(input) || !capture.canAddOutput(photos))
    throw error("E_CAMERA_CONFIG", "the capture session refused the camera or the photo output");

  capture.beginConfiguration();
  capture.addInput(input);
  capture.addOutput(photos);
  capture.commitConfiguration();
  // startRunning blocks until the camera runs: here, on the Lucent thread, not the main one.
  capture.startRunning();
  session = capture;
  output = photos;
}

/** Receives one photo, and writes it to a file. */
class Shot implements AVCapturePhotoCaptureDelegate {
  constructor(private readonly done: (photo: Photo | null, failure: Error | null) => void) {}

  photoOutput_didFinishProcessingPhoto_error(
    _output: AVCapturePhotoOutput,
    photo: AVCapturePhoto,
    failure: Error | null,
  ): void {
    if (failure) return this.done(null, failure);
    const jpeg = photo.fileDataRepresentation();
    if (!jpeg) return this.done(null, error("E_CAMERA_CAPTURE", "the photo has no data"));
    const path = `${NSTemporaryDirectory()}${fileName()}`;
    if (!FileManager.default.createFile(path, jpeg, null))
      return this.done(null, error("E_CAMERA_SAVE", `could not write ${path}`));
    this.done({ path, bytes: jpeg.length, takenAt: Date.now() }, null);
  }
}

// Delegates of the photos being taken, kept until each answers.
const shooting = new Set<Shot>();

function iosTakePhoto(): Promise<Photo> {
  const photos = output;
  if (!photos) throw error("E_CAMERA_CLOSED", "open the camera first");
  return fromCallback<Photo>((resolve, reject) => {
    const shot = new Shot((photo, failure) => {
      if (photo) resolve(photo);
      else reject(failure ?? error("E_CAMERA_CAPTURE", "no photo"));
    });
    shooting.add(shot);
    photos.capturePhoto(new AVCapturePhotoSettings(), shot);
    return () => {
      shooting.delete(shot);
    };
  });
}

function iosClose(): void {
  session?.stopRunning();
  session = null;
  output = null;
}

// --- Android: CameraX --------------------------------------------------------

let provider: ProcessCameraProvider | null = null;
let capture: ImageCapture | null = null;

/** Runs a Java callback on the thread that calls it: the Executor CameraX asks for. */
const direct = (command: Runnable | null) => command?.run();

/** The camera provider, once CameraX's ListenableFuture gives it. */
function started(
  future: ListenableFuture<ProcessCameraProvider> | null,
): Promise<ProcessCameraProvider> {
  return fromCallback<ProcessCameraProvider>((resolve, reject) => {
    if (!future) return reject(error("E_CAMERA_UNAVAILABLE", "CameraX did not start"));
    future.addListener(() => {
      try {
        const value = future.get();
        if (value === null) reject(error("E_CAMERA_UNAVAILABLE", "CameraX did not start"));
        else resolve(value);
      } catch (e) {
        reject(e as Error);
      }
    }, direct);
  });
}

function androidPermission(): Permission {
  const granted = appContext().checkSelfPermission("android.permission.CAMERA");
  // Android tells "denied for good" apart only while asking: before that, not granted is undetermined.
  return granted === PackageManager.PERMISSION_GRANTED ? "granted" : "undetermined";
}

async function androidOpen(facing: Facing): Promise<void> {
  const cameras = await started(ProcessCameraProvider.getInstance(appContext()));
  const selector =
    facing === "back" ? CameraSelector.DEFAULT_BACK_CAMERA : CameraSelector.DEFAULT_FRONT_CAMERA;
  if (!cameras.hasCamera(selector))
    throw error("E_CAMERA_UNAVAILABLE", `this device has no ${facing} camera`);

  const imageCapture = new ImageCapture_Builder()
    .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
    ?.build();
  if (!imageCapture) throw error("E_CAMERA_CONFIG", "CameraX made no ImageCapture");
  await main(() => {
    // CameraX follows a lifecycle: the Activity in front, which React Native's is.
    const activity = currentActivity();
    if (!(activity instanceof ComponentActivity))
      throw error("E_CAMERA_ACTIVITY", "no ComponentActivity in front to bind the camera to");
    cameras.unbindAll();
    cameras.bindToLifecycle(activity, selector, [imageCapture]);
  });
  provider = cameras;
  capture = imageCapture;
}

/** Hears whether CameraX saved the file. */
class Saved implements ImageCapture_OnImageSavedCallback {
  constructor(private readonly done: (failure: Error | null) => void) {}

  onImageSaved(_results: ImageCapture_OutputFileResults): void {
    this.done(null);
  }

  onError(exception: ImageCaptureException): void {
    this.done(error("E_CAMERA_CAPTURE", exception.getMessage() ?? "the capture failed"));
  }
}

function androidTakePhoto(): Promise<Photo> {
  const imageCapture = capture;
  if (!imageCapture) throw error("E_CAMERA_CLOSED", "open the camera first");
  const directory = appContext().getCacheDir();
  if (!directory) throw error("E_CAMERA_SAVE", "the app has no cache directory");
  const file = new File(directory, fileName());
  const options = new ImageCapture_OutputFileOptions_Builder(file).build();
  if (!options) throw error("E_CAMERA_CONFIG", "CameraX made no output options");

  return fromCallback<Photo>((resolve, reject) => {
    imageCapture.takePicture(
      options,
      direct,
      new Saved((failure) => {
        if (failure) return reject(failure);
        const path = file.getAbsolutePath() ?? "";
        resolve({ path, bytes: Number(file.length()), takenAt: Date.now() });
      }),
    );
  });
}

async function androidClose(): Promise<void> {
  const cameras = provider;
  provider = null;
  capture = null;
  if (cameras) await main(() => cameras.unbindAll());
}

// --- The module --------------------------------------------------------------

/** Whether the app may use the camera, without asking. */
export async function getPermission(): Promise<Permission> {
  return PLATFORM === "ios" ? iosPermission() : androidPermission();
}

/** Asks for the camera if the person hasn't answered; resolves with the answer. */
export async function requestPermission(): Promise<Permission> {
  if (PLATFORM === "ios") {
    if (iosPermission() !== "undetermined") return iosPermission();
    return (await AVCaptureDevice.requestAccess(AVMediaType.video)) ? "granted" : "denied";
  }
  const [granted] = await requestPermissions(["android.permission.CAMERA"]);
  return granted ? "granted" : "denied";
}

/**
 * Starts the `facing` camera; closes the one open before. Rejects with
 * E_CAMERA_PERMISSION before the person allows it, and E_CAMERA_UNAVAILABLE
 * on a device without that camera (the iOS simulator has none).
 */
export async function open(facing: Facing = "back"): Promise<void> {
  if ((await getPermission()) !== "granted")
    throw error("E_CAMERA_PERMISSION", "the camera is not allowed: call requestPermission() first");
  await close();
  if (PLATFORM === "ios") await iosOpen(facing);
  else await androidOpen(facing);
  // Let auto-exposure settle before the first photo.
  await delay(300);
}

/** Takes a photo with the open camera and saves it as a JPEG in the cache directory. */
export async function takePhoto(): Promise<Photo> {
  return PLATFORM === "ios" ? iosTakePhoto() : androidTakePhoto();
}

/** Stops the camera. Nothing happens when it isn't open. */
export async function close(): Promise<void> {
  if (PLATFORM === "ios") iosClose();
  else await androidClose();
}
