import { useEffect, useState } from "react";
import { Button } from "../../ui/Button";
import { ButtonRow } from "../../ui/ButtonRow";
import { Card } from "../../ui/Card";
import { CodeBlock } from "../../ui/CodeBlock";
import { Notice } from "../../ui/Notice";
import { TextField } from "../../ui/TextField";
import { describeError } from "../describeError";
import { NoteRow } from "./NoteRow";
import { PickCard } from "./PickCard";
import * as Sandbox from "./sandbox.lucent";

const newName = () => `note-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;

export function FilesDemo() {
  const [directory, setDirectory] = useState<string | null>(null);
  const [notes, setNotes] = useState<Sandbox.Note[]>([]);
  const [draft, setDraft] = useState("Written to the app sandbox by a Lucent module.");
  const [opened, setOpened] = useState<{ name: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function attempt(action: () => Promise<void>) {
    try {
      await action();
      setNotes(await Sandbox.listAsync());
      setError(null);
    } catch (e) {
      setError(describeError(e));
    }
  }

  useEffect(() => {
    void attempt(async () => setDirectory(await Sandbox.directoryAsync()));
  }, []);

  async function open(name: string) {
    const text = await Sandbox.readAsync(name);
    setOpened(text === null ? null : { name, text });
  }

  async function remove(name: string) {
    await Sandbox.deleteAsync(name);
    if (opened?.name === name) setOpened(null);
  }

  return (
    <>
      {error ? <Notice tone="danger" title="File operation failed" message={error} /> : null}

      <Card title="New note">
        <TextField
          testID="note-text"
          label="Text"
          value={draft}
          onChangeText={setDraft}
          multiline
        />

        <Button
          testID="note-save"
          label="Save as a new file"
          onPress={() => void attempt(() => Sandbox.writeAsync(newName(), draft))}
        />
      </Card>

      <Card title={`Files (${notes.length})`}>
        {notes.length === 0 ? <Notice title="No notes yet" message="Save one above." /> : null}

        {notes.map((note) => (
          <NoteRow
            key={note.name}
            note={note}
            onOpen={() => void attempt(() => open(note.name))}
            onDelete={() => void attempt(() => remove(note.name))}
          />
        ))}
      </Card>

      {opened ? (
        <Card title={opened.name}>
          <CodeBlock testID="note-opened" text={opened.text} />

          <ButtonRow>
            <Button label="Close" variant="secondary" onPress={() => setOpened(null)} />
          </ButtonRow>
        </Card>
      ) : null}

      <PickCard />

      {directory ? (
        <Card title="Directory">
          <CodeBlock text={directory} />
        </Card>
      ) : null}
    </>
  );
}
