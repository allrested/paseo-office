import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { View } from "react-native";
import { Text } from "./text.js";
import { ChatIcon } from "./chat-chrome.js";
import type { OfficeStyles } from "./styles.js";
import {
  fileRefusal,
  readTextFile,
  sizeLabel,
  type ReplyFile,
  type ReplyFiles,
} from "./reply-send.js";
import type { SetStateAction } from "react";

interface FileDraft {
  files: ReplyFiles;
  setFiles(next: SetStateAction<ReplyFiles>): void;
}

let fileId = 0;

/** Attaches text files to the reply: the host has no file call, so their text joins the message. */
export function FilePicker({
  draft,
  styles,
  onReading,
}: {
  draft: FileDraft;
  styles: OfficeStyles;
  onReading(value: boolean): void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const loading = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      onReading(false);
    };
  }, [onReading]);
  const [error, setError] = useState<string | null>(null);
  const open = useCallback(() => ref.current?.click(), []);
  const { files: attached, setFiles } = draft;
  const pick = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const chosen = Array.from(event.currentTarget.files ?? []);
      event.currentTarget.value = "";
      const refusal = fileRefusal(attached, chosen);
      if (refusal) {
        setError(refusal);
        return;
      }
      if (loading.current) return;
      loading.current = true;
      onReading(true);
      try {
        const additions: ReplyFile[] = [];
        for (const file of chosen) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const text = readTextFile(bytes);
          if (text === null) {
            if (mounted.current) setError("This file is not text, so it cannot be added.");
            return;
          }
          additions.push({ id: ++fileId, name: file.name, size: bytes.length, text });
        }
        if (!mounted.current) return;
        setFiles((previous) => [...previous, ...additions]);
        setError(null);
      } catch {
        if (mounted.current) setError("The browser could not read this file.");
      } finally {
        loading.current = false;
        if (mounted.current) onReading(false);
      }
    },
    [attached, setFiles, onReading],
  );
  return (
    <>
      <input type="file" ref={ref} multiple hidden onChange={pick} aria-label="Choose text files" />
      <ChatIcon name="FilePlus" label="Attach text files" onPress={open} styles={styles} />
      {error && (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {error}
        </Text>
      )}
    </>
  );
}

/** The attached files as chips with their size and a Remove, and a line saying what a send does. */
export function FileDrafts({ draft, styles }: { draft: FileDraft; styles: OfficeStyles }) {
  return (
    <>
      <View style={styles.chatReactions}>
        {draft.files.map((file) => (
          <FileChip key={file.id} file={file} setFiles={draft.setFiles} styles={styles} />
        ))}
      </View>
      <Text style={styles.chatMeta}>{"The file's text is added to the message."}</Text>
    </>
  );
}

function FileChip({
  file,
  setFiles,
  styles,
}: {
  file: ReplyFile;
  setFiles: FileDraft["setFiles"];
  styles: OfficeStyles;
}) {
  const remove = useCallback(
    () => setFiles((items) => items.filter((item) => item !== file)),
    [setFiles, file],
  );
  return (
    <View style={styles.messenger.preview}>
      <Text style={styles.chatMeta}>{`${file.name} · ${sizeLabel(file.size)}`}</Text>
      <ChatIcon name="X" label={`Remove ${file.name}`} onPress={remove} styles={styles} />
    </View>
  );
}
