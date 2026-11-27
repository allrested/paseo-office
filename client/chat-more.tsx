import { useCallback, useState } from "react";
import { View } from "react-native";
import { Text } from "./text.js";
import { ActionButton } from "./action-button.js";
import { ChatIcon } from "./chat-chrome.js";
import { Dictation } from "./chat-dictation.js";
import { QuickMessages } from "./chat-quick.js";
import type { ChatDraft } from "./office-link.js";
import type { OfficeStyles } from "./styles.js";

export interface ChatShortcuts {
  onBoard?(): void;
  onDuties?(): void;
  onNewAgent?(): void;
  onGroupPhoto?(): Promise<void>;
}

export function ChatMore({
  draft,
  web,
  styles,
  onClose,
  onBoard,
  onDuties,
  onNewAgent,
  onGroupPhoto,
  onClear,
  onUse,
}: ChatShortcuts & {
  /** Resolves true once the chat is cleared. */
  onClear(): Promise<boolean>;
  draft: ChatDraft;
  web: boolean;
  styles: OfficeStyles;
  onClose(): void;
  onUse(prompt: string): void;
}) {
  const [quick, setQuick] = useState(false);
  const toggle = useCallback(() => setQuick((value) => !value), []);
  const board = useCallback(() => {
    onClose();
    onBoard?.();
  }, [onClose, onBoard]);
  const dutyBoard = useCallback(() => {
    onClose();
    onDuties?.();
  }, [onClose, onDuties]);
  const newAgent = useCallback(() => {
    onClose();
    onNewAgent?.();
  }, [onClose, onNewAgent]);
  const photo = useCallback(async () => {
    await onGroupPhoto?.();
    onClose();
  }, [onClose, onGroupPhoto]);
  const pick = useCallback(
    (text: string) => {
      onClose();
      onUse(text);
    },
    [onClose, onUse],
  );
  // Clearing is for everyone and cannot be undone, so it asks first.
  const [clearing, setClearing] = useState(false);
  const askClear = useCallback(() => setClearing(true), []);
  const keep = useCallback(() => setClearing(false), []);
  const clear = useCallback(async () => {
    if (await onClear()) onClose();
    else setClearing(false);
  }, [onClear, onClose]);
  if (clearing)
    return (
      <View style={styles.messenger.morePanel}>
        <View style={styles.messenger.quickRow}>
          <Text style={styles.messenger.sectionTitle}>
            {"Clear all messages for everyone? This can't be undone."}
          </Text>
        </View>
        <View style={styles.messenger.toolbar}>
          <ActionButton
            label="Clear all messages"
            pendingLabel="Clearing…"
            onPress={clear}
            primary
            styles={styles}
          />
          <ActionButton label="Cancel" pendingLabel="Cancel" onPress={keep} styles={styles} />
        </View>
      </View>
    );
  return (
    <View style={styles.messenger.morePanel}>
      <View style={styles.messenger.quickRow}>
        <Text accessibilityRole="header" style={styles.messenger.sectionTitle}>
          {quick ? "Quick messages" : "More actions"}
        </Text>
        <ChatIcon
          label={quick ? "Back to chat actions" : "Close chat actions"}
          name={quick ? "ArrowLeft" : "X"}
          onPress={quick ? toggle : onClose}
          styles={styles}
        />
      </View>
      {quick ? (
        <QuickMessages text={draft.text} onUse={pick} styles={styles} />
      ) : (
        <View style={styles.messenger.toolbar}>
          <ActionButton
            label="Quick messages"
            pendingLabel="Quick messages"
            onPress={toggle}
            styles={styles}
          />
          {onBoard && (
            <ActionButton
              label="Lobby board"
              pendingLabel="Lobby board"
              onPress={board}
              styles={styles}
            />
          )}
          {onDuties && (
            <ActionButton
              label="Duty board"
              pendingLabel="Duty board"
              onPress={dutyBoard}
              styles={styles}
            />
          )}
          {onNewAgent && (
            <ActionButton
              label="New agent"
              pendingLabel="New agent"
              onPress={newAgent}
              styles={styles}
            />
          )}
          {onGroupPhoto && (
            <ActionButton
              label="Take office photo"
              pendingLabel="Taking photo…"
              onPress={photo}
              styles={styles}
            />
          )}
          {web && <Dictation setText={draft.setText} styles={styles} />}
          <ActionButton
            label="Clear chat"
            pendingLabel="Clear chat"
            onPress={askClear}
            styles={styles}
          />
        </View>
      )}
    </View>
  );
}
