import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { Button } from "../../ui/Button";
import { ButtonRow } from "../../ui/ButtonRow";
import { Card } from "../../ui/Card";
import { Notice } from "../../ui/Notice";
import { describeError } from "../describeError";
import { lastPickedAsync, pickDocumentAsync, recreateActivityAfter } from "./picker.lucent";

/** Picks a document with the system's picker (Android). */
export function PickCard() {
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  // A pick that finished while the Activity (and this screen) was recreated.
  useEffect(() => {
    void lastPickedAsync().then((uri) => {
      if (uri) setPicked(uri);
    });
  }, []);

  if (Platform.OS !== "android") return null;

  async function pick(recreate: boolean) {
    controller.current = new AbortController();
    if (recreate) void recreateActivityAfter(2000);

    setPending(true);
    setError(null);

    try {
      setPicked(await pickDocumentAsync(controller.current.signal));
    } catch (e) {
      setError(describeError(e));
    }

    setPending(false);
  }

  return (
    <Card title="Pick a document">
      <ButtonRow>
        <Button
          testID="pick-document"
          label="Pick"
          busy={pending}
          onPress={() => void pick(false)}
        />

        <Button
          testID="pick-recreating"
          label="Pick, recreating the Activity"
          variant="secondary"
          disabled={pending}
          onPress={() => void pick(true)}
        />

        {pending ? (
          <Button
            testID="pick-cancel"
            label="Cancel"
            variant="danger"
            onPress={() => controller.current?.abort()}
          />
        ) : null}
      </ButtonRow>

      {picked !== undefined ? (
        <Notice
          testID="pick-result"
          tone={picked ? "success" : "warning"}
          title={picked ? "Picked" : "Nothing picked"}
          message={picked ?? undefined}
        />
      ) : null}

      {error ? <Notice tone="danger" title="Picking failed" message={error} /> : null}
    </Card>
  );
}
