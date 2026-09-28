import { useEffect, useState } from "react";
import * as Application from "../../sdk/application.lucent";
import * as Device from "../../sdk/device.lucent";
import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { InfoRow } from "../../ui/InfoRow";
import { Notice } from "../../ui/Notice";
import { ProgressBar } from "../../ui/ProgressBar";
import { describeError } from "../describeError";
import { ActivityCard } from "./ActivityCard";
import { getPowerInfoAsync, type PowerInfo } from "./battery.lucent";

interface Snapshot {
  device: Device.DeviceInfo;
  power: PowerInfo;
  app: { id: string | null; name: string | null; version: string; installed: Date };
}

async function snapshot(): Promise<Snapshot> {
  const [device, power, installed] = await Promise.all([
    Device.getDeviceInfoAsync(),
    getPowerInfoAsync(),
    Application.getInstallationTimeAsync(),
  ]);

  return {
    device,
    power,
    app: {
      id: Application.applicationId(),
      name: Application.applicationName(),
      version: `${Application.nativeApplicationVersion()} (${Application.nativeBuildVersion()})`,
      installed,
    },
  };
}

const gigabytes = (bytes: number | null) =>
  bytes ? `${(bytes / 2 ** 30).toFixed(1)} GB` : "unknown";

export function DeviceDemo() {
  const [info, setInfo] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setInfo(await snapshot());
      setError(null);
    } catch (e) {
      setError(describeError(e));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  if (error) return <Notice tone="danger" title="Could not read the device" message={error} />;

  if (!info) return <Notice title="Reading the device…" />;

  const { device, power, app } = info;

  return (
    <>
      <Card title="Battery and power">
        {power.level === null ? (
          <Notice
            tone="warning"
            title="No battery level"
            message="This device does not report one (simulators don't)."
          />
        ) : (
          <>
            <InfoRow
              testID="battery-level"
              label="Level"
              value={`${Math.round(power.level * 100)}%`}
            />
            <ProgressBar value={power.level} />
          </>
        )}

        <InfoRow label="State" value={power.state} />
        <InfoRow label="Low power mode" value={power.lowPowerMode ? "on" : "off"} />
        <InfoRow label="Thermal state" value={power.thermalState} />
      </Card>

      <Card title="Device">
        <InfoRow label="Manufacturer" value={device.manufacturer ?? "unknown"} />
        <InfoRow label="Brand" value={device.brand ?? "unknown"} />
        <InfoRow
          testID="device-os"
          label="System"
          value={`${device.osName ?? "?"} ${device.osVersion ?? ""}`}
        />
        <InfoRow label="Memory" value={gigabytes(device.totalMemory)} />
      </Card>

      <ActivityCard />

      <Card title="This app">
        <InfoRow label="Name" value={app.name ?? "unknown"} />
        <InfoRow label="Identifier" value={app.id ?? "unknown"} />
        <InfoRow label="Version" value={app.version} />
        <InfoRow label="Installed" value={app.installed.toLocaleString()} />
      </Card>

      <Button
        testID="device-refresh"
        label="Refresh"
        variant="secondary"
        onPress={() => void refresh()}
      />
    </>
  );
}
