import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import * as LocalAuthentication from "../../sdk/localAuthentication.lucent";
import { Button } from "../../ui/Button";
import { ButtonRow } from "../../ui/ButtonRow";
import { Card } from "../../ui/Card";
import { InfoRow } from "../../ui/InfoRow";
import { Notice } from "../../ui/Notice";
import { describeError } from "../describeError";
import { authenticateAsync, type SignInResult } from "./biometrics.lucent";

interface Capabilities {
  hardware: boolean;
  enrolled: boolean;
  types: number[];
  level: number;
}

const TYPES = ["", "fingerprint", "face", "iris"];

const LEVELS = ["none", "device passcode", "weak biometrics", "strong biometrics"];

async function capabilities(): Promise<Capabilities> {
  return {
    hardware: await LocalAuthentication.hasHardwareAsync(),
    enrolled: await LocalAuthentication.isEnrolledAsync(),
    types: await LocalAuthentication.supportedAuthenticationTypesAsync(),
    level: await LocalAuthentication.getEnrolledLevelAsync(),
  };
}

const RESULTS: Record<string, { title: string; tone: "success" | "warning" | "danger" }> = {
  success: { title: "Signed in", tone: "success" },
  cancelled: { title: "Cancelled", tone: "warning" },
  not_enrolled: { title: "Nothing enrolled to check against", tone: "warning" },
  not_available: { title: "Not available on this device", tone: "warning" },
  lockout: { title: "Locked out after too many attempts", tone: "danger" },
  failed: { title: "Not recognized", tone: "danger" },
};

export function BiometricsDemo() {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [result, setResult] = useState<SignInResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    capabilities().then(setCaps, (e: unknown) => setError(describeError(e)));

    return () => controller.current?.abort();
  }, []);

  async function signIn() {
    controller.current = new AbortController();
    setPending(true);
    setResult(null);

    try {
      setResult(
        await authenticateAsync("Sign in to the Lucent example", controller.current.signal),
      );
    } catch (e) {
      setError(describeError(e));
    }

    setPending(false);
  }

  const outcome = result
    ? (RESULTS[result.success ? "success" : (result.error ?? "")] ?? null)
    : null;

  return (
    <>
      <Card title="This device">
        {caps ? (
          <>
            <InfoRow
              testID="biometrics-hardware"
              label="Biometric hardware"
              value={caps.hardware ? "yes" : "no"}
            />
            <InfoRow label="Enrolled" value={caps.enrolled ? "yes" : "no"} />
            <InfoRow
              label="Kinds"
              value={
                caps.types.length ? caps.types.map((t) => TYPES[t] ?? String(t)).join(", ") : "none"
              }
            />
            <InfoRow label="Security level" value={LEVELS[caps.level] ?? String(caps.level)} />
          </>
        ) : (
          <Notice title="Checking…" />
        )}

        {caps && !caps.hardware ? (
          <Notice
            tone="warning"
            title="No biometric hardware"
            message="Sign-in falls back to the device passcode, if one is set."
          />
        ) : null}

        {caps?.hardware && !caps.enrolled ? (
          <Notice
            tone="warning"
            title="No biometrics enrolled"
            message={
              Platform.OS === "ios"
                ? "On the simulator: Features › Face ID › Enrolled."
                : "Add a fingerprint in the system settings."
            }
          />
        ) : null}
      </Card>

      <Card title="Sign in">
        {Platform.OS === "android" ? (
          <Notice
            title="The screen lock's own check"
            message="Android asks through the system's confirm-credential screen, started for a result from the Activity in front."
          />
        ) : null}

        <ButtonRow>
          <Button
            testID="biometrics-sign-in"
            label="Sign in"
            busy={pending}
            onPress={() => void signIn()}
          />

          {pending ? (
            <Button
              testID="biometrics-cancel"
              label="Cancel"
              variant="danger"
              onPress={() => controller.current?.abort()}
            />
          ) : null}
        </ButtonRow>

        {outcome ? (
          <Notice testID="biometrics-result" tone={outcome.tone} title={outcome.title} />
        ) : null}

        {result && !outcome ? (
          <Notice tone="danger" title={`Failed: ${result.error ?? "unknown"}`} />
        ) : null}

        {error ? <Notice tone="danger" title="Sign-in failed" message={error} /> : null}
      </Card>
    </>
  );
}
