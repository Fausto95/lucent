import { useState } from "react";
import {
  ImpactFeedbackStyle,
  impactAsync,
  NotificationFeedbackType,
  notificationAsync,
  selectionAsync,
} from "lucent-haptics";
import { now } from "../../clock";
import * as Clipboard from "../../sdk/clipboard.lucent";
import { Button } from "../../ui/Button";
import { ButtonRow } from "../../ui/ButtonRow";
import { Card } from "../../ui/Card";
import { InfoRow } from "../../ui/InfoRow";
import { Notice } from "../../ui/Notice";
import { TextField } from "../../ui/TextField";
import { describeError } from "../describeError";

const IMPACTS = [
  ImpactFeedbackStyle.Light,
  ImpactFeedbackStyle.Medium,
  ImpactFeedbackStyle.Heavy,
  ImpactFeedbackStyle.Soft,
  ImpactFeedbackStyle.Rigid,
];

const NOTIFICATIONS = [
  NotificationFeedbackType.Success,
  NotificationFeedbackType.Warning,
  NotificationFeedbackType.Error,
];

const capitalized = (s: string) => s[0]!.toUpperCase() + s.slice(1);

export function HapticsDemo() {
  const [last, setLast] = useState<{ title: string; ok: boolean } | null>(null);
  const [text, setText] = useState("Copied by a Lucent module ✓");
  const [pasted, setPasted] = useState<string | null>(null);
  const [hasText, setHasText] = useState<boolean | null>(null);

  async function feel(name: string, feedback: () => Promise<void>) {
    const start = now();

    try {
      await feedback();
      setLast({ title: `${name} · ${(now() - start).toFixed(1)} ms`, ok: true });
    } catch (e) {
      setLast({ title: `${name}: ${describeError(e)}`, ok: false });
    }
  }

  async function copy() {
    await Clipboard.setStringAsync(text);
    setHasText(await Clipboard.hasStringAsync());
  }

  async function paste() {
    setPasted(await Clipboard.getStringAsync());
    setHasText(await Clipboard.hasStringAsync());
  }

  return (
    <>
      <Card title="Impact">
        <ButtonRow>
          {IMPACTS.map((style) => (
            <Button
              key={style}
              testID={`impact-${style}`}
              label={capitalized(style)}
              variant="secondary"
              onPress={() => void feel(`impactAsync(${style})`, () => impactAsync(style))}
            />
          ))}
        </ButtonRow>
      </Card>

      <Card title="Notification and selection">
        <ButtonRow>
          {NOTIFICATIONS.map((type) => (
            <Button
              key={type}
              testID={`notification-${type}`}
              label={capitalized(type)}
              variant="secondary"
              onPress={() => void feel(`notificationAsync(${type})`, () => notificationAsync(type))}
            />
          ))}

          <Button
            testID="selection"
            label="Selection"
            variant="secondary"
            onPress={() => void feel("selectionAsync()", selectionAsync)}
          />
        </ButtonRow>

        {last ? <Notice tone={last.ok ? "success" : "danger"} title={last.title} /> : null}
      </Card>

      <Card title="Clipboard">
        <TextField
          testID="clipboard-text"
          label="Text to copy"
          value={text}
          onChangeText={setText}
        />

        <ButtonRow>
          <Button testID="clipboard-copy" label="Copy" onPress={() => void copy()} />

          <Button
            testID="clipboard-paste"
            label="Paste"
            variant="secondary"
            onPress={() => void paste()}
          />
        </ButtonRow>

        {hasText === null ? null : (
          <InfoRow label="Clipboard has text" value={hasText ? "yes" : "no"} />
        )}

        {pasted === null ? null : (
          <InfoRow testID="clipboard-pasted" label="Pasted" value={pasted || "(empty)"} />
        )}
      </Card>
    </>
  );
}
