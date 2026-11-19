import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { ActionButton } from "./action-button.js";
import { ChatIcon } from "./chat-chrome.js";
import { Dictation } from "./chat-dictation.js";
import { QuickMessages } from "./chat-quick.js";
import type { ChatDraft } from "./office-link.js";
import type { OfficeStyles } from "./styles.js";

export interface ChatShortcuts {
  onBoard?(): void;
  onNewAgent?(): void;
  onGroupPhoto?(): Promise<void>;
}

export function ChatMore({
  draft,
  web,
  styles,
  onClose,
  onBoard,
  onNewAgent,
  onGroupPhoto,
  onUse,
}: ChatShortcuts & {
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
        </View>
      )}
    </View>
  );
}
