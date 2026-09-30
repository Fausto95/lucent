import { useEffect, useState } from "react";
import * as SecureStore from "lucent-secure-store";
import { Button } from "../../ui/Button";
import { ButtonRow } from "../../ui/ButtonRow";
import { Card } from "../../ui/Card";
import { InfoRow } from "../../ui/InfoRow";
import { Notice } from "../../ui/Notice";
import { TextField } from "../../ui/TextField";
import { describeError } from "../describeError";

const KEY = "demo.api-token";

const masked = (value: string) => "•".repeat(Math.min(value.length, 24));

export function SecureStoreDemo() {
  const [draft, setDraft] = useState("s3cr3t-token-42");
  const [stored, setStored] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);

  async function act(what: string, action: () => Promise<void>) {
    try {
      await action();
      setStored(await SecureStore.getItemAsync(KEY));
      setStatus({ text: what, ok: true });
    } catch (e) {
      setStatus({ text: `${what} failed: ${describeError(e)}`, ok: false });
    }
  }

  useEffect(() => {
    void act("Read the stored value", async () => {});
  }, []);

  return (
    <>
      <Card title={`Key "${KEY}"`}>
        <TextField
          testID="secret"
          label="Secret"
          value={draft}
          onChangeText={setDraft}
          secure={!revealed}
        />

        <ButtonRow>
          <Button
            testID="secret-save"
            label="Save"
            onPress={() => void act("Saved", () => SecureStore.setItemAsync(KEY, draft))}
          />

          <Button
            testID="secret-delete"
            label="Delete"
            variant="danger"
            onPress={() => void act("Deleted", () => SecureStore.deleteItemAsync(KEY))}
          />

          <Button
            testID="secret-reveal"
            label={revealed ? "Hide" : "Reveal"}
            variant="secondary"
            onPress={() => setRevealed(!revealed)}
          />
        </ButtonRow>
      </Card>

      <Card title="In the secure store">
        <InfoRow
          testID="secret-stored"
          label="Stored value"
          value={stored === null ? "nothing" : revealed ? stored : masked(stored)}
        />

        {status ? <Notice tone={status.ok ? "success" : "danger"} title={status.text} /> : null}
      </Card>
    </>
  );
}
