import { useEffect, useRef, useState } from "react";
import * as NetInfo from "../../sdk/netInfo.lucent";
import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { InfoRow } from "../../ui/InfoRow";
import { Notice } from "../../ui/Notice";
import { describeError } from "../describeError";
import { StateLog, type LoggedState } from "./StateLog";

const MAX_LOG = 8;

const yesNo = (value: boolean | null | undefined) =>
  value === null || value === undefined ? "unknown" : value ? "yes" : "no";

export function NetworkDemo() {
  const [state, setState] = useState<NetInfo.NetInfoState | null>(null);
  const [log, setLog] = useState<LoggedState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const count = useRef(0);

  function record(next: NetInfo.NetInfoState, source: LoggedState["source"]) {
    const entry = { id: count.current++, state: next, source, at: new Date() };

    setState(next);
    setLog((previous) => [entry, ...previous].slice(0, MAX_LOG));
  }

  useEffect(() => {
    let id: number | null = null;
    let closed = false;

    NetInfo.addEventListener((next) => record(next, "listener")).then(
      (listener) => {
        if (closed) void NetInfo.removeEventListener(listener);
        else id = listener;
      },
      (e: unknown) => setError(describeError(e)),
    );

    return () => {
      closed = true;
      if (id !== null) void NetInfo.removeEventListener(id);
    };
  }, []);

  async function fetchNow() {
    try {
      record(await NetInfo.fetch(), "fetch");
    } catch (e) {
      setError(describeError(e));
    }
  }

  return (
    <>
      {error ? <Notice tone="danger" title="Network status failed" message={error} /> : null}

      <Card title="Now">
        {state ? (
          <>
            <InfoRow testID="network-type" label="Connection" value={state.type} />
            <InfoRow label="Connected" value={yesNo(state.isConnected)} />
            <InfoRow label="Internet reachable" value={yesNo(state.isInternetReachable)} />
            <InfoRow label="Expensive" value={yesNo(state.details?.isConnectionExpensive)} />
          </>
        ) : (
          <Notice title="Waiting for the first update…" />
        )}

        <Button
          testID="network-fetch"
          label="Fetch now"
          variant="secondary"
          onPress={() => void fetchNow()}
        />
      </Card>

      <Card title="Updates">
        <StateLog entries={log} />
      </Card>
    </>
  );
}
