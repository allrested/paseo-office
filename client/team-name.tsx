import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { TextInput } from "@getpaseo/plugin/client/ui";
import { teamRenameRpc } from "../shared/contracts.js";
import type { OfficeRoom } from "../shared/model.js";
import { TEAM_NAME_MAX } from "../shared/team-name.js";
import { ActionButton } from "./action-button.js";
import type { OfficeStyles } from "./styles.js";

interface TeamNameProps {
  room: OfficeRoom;
  styles: OfficeStyles;
}

const HINT = "The office's own name for this team. Empty goes back to the workspace's name.";

/**
 * Gives a room's team a name of the office's own: a line under the room's title that opens a
 * field. The workspace keeps its name in Paseo; while the team goes by another, the line says
 * which workspace it is.
 */
export function TeamName({ room, styles }: TeamNameProps) {
  const rename = useRpc(teamRenameRpc);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const workspace = room.workspace;
  const own = workspace?.workspaceName;
  const start = useCallback(() => {
    // The field starts from the team's own name, empty while it goes by the workspace's.
    setDraft(own === undefined ? "" : room.name);
    setOpen(true);
  }, [own, room.name]);
  const cancel = useCallback(() => setOpen(false), []);
  const save = useCallback(async () => {
    if (!workspace) return;
    const answer = await rename({ workspaceId: workspace.id, name: draft });
    if (!answer.ok) throw new Error(answer.problem);
    setOpen(false);
  }, [rename, workspace, draft]);
  if (!workspace) return null;
  if (!open) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Rename team ${room.name}`}
        onPress={start}
      >
        <Text style={styles.fieldHint}>
          {own === undefined ? "Rename team" : `Workspace ${own} · Rename team`}
        </Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.headerField}>
      <TextInput
        accessibilityLabel="Team name"
        accessibilityHint={HINT}
        value={draft}
        onChangeText={setDraft}
        maxLength={TEAM_NAME_MAX}
        placeholder={own ?? room.name}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.fieldInput}
      />
      <Text style={styles.fieldHint}>{HINT}</Text>
      <View style={styles.actions}>
        <ActionButton
          label="Save team name"
          pendingLabel="Saving..."
          onPress={save}
          primary
          styles={styles}
        />
        <ActionButton label="Cancel" pendingLabel="Cancel" onPress={cancel} styles={styles} />
      </View>
    </View>
  );
}
