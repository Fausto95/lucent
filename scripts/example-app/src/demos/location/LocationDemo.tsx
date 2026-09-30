import { useEffect, useRef, useState } from "react";
import * as Location from "../../sdk/location.lucent";
import { Button } from "../../ui/Button";
import { ButtonRow } from "../../ui/ButtonRow";
import { Card } from "../../ui/Card";
import { InfoRow } from "../../ui/InfoRow";
import { Notice } from "../../ui/Notice";
import { describeError } from "../describeError";
import { requestPermission } from "./requestPermission";

interface Status {
  services: boolean;
  permission: string;
}

const TIMEOUT = 15000;

/** Fails after TIMEOUT, so a fix that never comes shows as an error. */
function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`No position in ${TIMEOUT / 1000} s`)), TIMEOUT),
    ),
  ]);
}

const degrees = (value: number) => `${value.toFixed(5)}°`;

export function LocationDemo() {
  const [status, setStatus] = useState<Status | null>(null);
  const [position, setPosition] = useState<Location.LocationObject | null>(null);
  const [lastKnown, setLastKnown] = useState(false);
  const [updates, setUpdates] = useState(0);
  const [watching, setWatching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const watch = useRef<number | null>(null);

  async function readStatus(): Promise<Status> {
    const next = {
      services: await Location.hasServicesEnabledAsync(),
      permission: (await Location.getForegroundPermissionsAsync()).status,
    };

    setStatus(next);

    return next;
  }

  async function locate() {
    setBusy(true);

    try {
      setPosition(await withTimeout(Location.getCurrentPositionAsync()));
      setLastKnown(false);
      setError(null);
    } catch (e) {
      // No fresh fix (indoors, or an emulator without a GPS feed): the last one the system has will do.
      const last = await Location.getLastKnownPositionAsync();
      if (last) setPosition(last);
      setLastKnown(last !== null);
      setError(describeError(e));
    }

    setBusy(false);
  }

  async function allow() {
    try {
      await requestPermission();
      if ((await readStatus()).permission === "granted") await locate();
    } catch (e) {
      setError(describeError(e));
    }
  }

  async function toggleWatch() {
    if (watch.current !== null) {
      await Location.stopWatching(watch.current);
      watch.current = null;
      setWatching(false);
      return;
    }

    watch.current = await Location.watchPositionAsync((next) => {
      setPosition(next);
      setUpdates((n) => n + 1);
    });
    setWatching(true);
  }

  useEffect(() => {
    readStatus().then(
      (s) => (s.permission === "granted" ? locate() : undefined),
      (e: unknown) => setError(describeError(e)),
    );

    return () => {
      if (watch.current !== null) void Location.stopWatching(watch.current);
    };
  }, []);

  const granted = status?.permission === "granted";

  return (
    <>
      <Card title="Access">
        <InfoRow
          label="Location services"
          value={status ? (status.services ? "on" : "off") : "…"}
        />
        <InfoRow
          testID="location-permission"
          label="Permission"
          value={status?.permission ?? "…"}
        />

        {status && !granted ? (
          <Button
            testID="location-allow"
            label="Allow location access"
            onPress={() => void allow()}
          />
        ) : null}
      </Card>

      {granted ? (
        <Card title="Position">
          {position ? (
            <>
              <InfoRow
                testID="location-latitude"
                label="Latitude"
                value={degrees(position.coords.latitude)}
              />
              <InfoRow label="Longitude" value={degrees(position.coords.longitude)} />
              <InfoRow
                label="Accuracy"
                value={
                  position.coords.accuracy === null
                    ? "unknown"
                    : `± ${Math.round(position.coords.accuracy)} m`
                }
              />
              <InfoRow
                label={lastKnown ? "Last known fix" : "Fix time"}
                value={new Date(position.timestamp).toLocaleString()}
              />
              {watching ? <InfoRow label="Updates while watching" value={String(updates)} /> : null}
            </>
          ) : (
            <Notice title={busy ? "Locating…" : "No position yet"} />
          )}

          <ButtonRow>
            <Button
              testID="location-locate"
              label="Locate me"
              busy={busy}
              onPress={() => void locate()}
            />

            <Button
              testID="location-watch"
              label={watching ? "Stop watching" : "Watch"}
              variant="secondary"
              onPress={() => void toggleWatch()}
            />
          </ButtonRow>
        </Card>
      ) : null}

      {error ? (
        <Notice
          tone={lastKnown ? "warning" : "danger"}
          title={lastKnown ? "No fresh position: showing the last known one" : "Location failed"}
          message={error}
        />
      ) : null}
    </>
  );
}
