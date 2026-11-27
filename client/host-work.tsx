import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { Text } from "./text.js";
import { useRpc } from "@getpaseo/plugin/client";
import { forgottenRpc, type OfficeAgent } from "../shared/contracts.js";
import {
  coordinatorModels,
  forgottenText,
  subModelsText,
  type Forgotten,
} from "../shared/forgotten.js";
import { ActionButton } from "./action-button.js";
import type { OfficeStyles } from "./styles.js";

/**
 * Checkouts with work nobody finished: changed files, commits on no remote, a stash. Read when
 * asked, since it runs git in every workspace's folder.
 */
export function ForgottenWork({ styles }: { styles: OfficeStyles }) {
  const read = useRpc(forgottenRpc);
  const [found, setFound] = useState<readonly Forgotten[] | null>(null);
  const check = useCallback(async () => {
    const answer = await read({});
    setFound(answer.items);
  }, [read]);
  return (
    <View style={styles.host.group}>
      <View style={styles.host.groupHead}>
        <Text accessibilityRole="header" style={styles.host.title}>
          Forgotten work
        </Text>
        <ActionButton
          label={found === null ? "Check" : "Check again"}
          pendingLabel="Checking..."
          name="Check for forgotten work"
          onPress={check}
          styles={styles}
        />
      </View>
      {found === null && (
        <Text style={styles.host.note}>
          Looks in each workspace&apos;s folder, and its repository&apos;s other worktrees, for
          files not committed, commits no remote has, and stashes.
        </Text>
      )}
      {found !== null && found.length === 0 && (
        <Text style={styles.host.empty}>Every checkout is committed and pushed.</Text>
      )}
      {found?.map((item) => (
        <View
          key={`${item.workspaceId ?? ""}:${item.name}`}
          accessible
          accessibilityRole="text"
          accessibilityLabel={`${item.name}: ${forgottenText(item)}`}
        >
          <Text style={styles.host.name}>{item.name}</Text>
          <Text style={styles.host.note}>
            {forgottenText(item)}
            {item.workspaceId === null ? " (a worktree no workspace has)" : ""}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Each agent that has sub-agents, with its model and the models they run on; nothing while none has. */
export function SubagentModels({
  agents,
  styles,
}: {
  agents: readonly OfficeAgent[];
  styles: OfficeStyles;
}) {
  const coordinators = useMemo(() => coordinatorModels(agents), [agents]);
  if (coordinators.length === 0) return null;
  return (
    <View style={styles.host.group}>
      <Text accessibilityRole="header" style={styles.host.title}>
        Models
      </Text>
      {coordinators.map((lead) => {
        const text = `${lead.model ?? "an unnamed model"}; sub-agents: ${subModelsText(lead.subs)}`;
        return (
          <View
            key={lead.id}
            accessible
            accessibilityRole="text"
            accessibilityLabel={`${lead.name}: ${text}`}
          >
            <Text style={styles.host.name}>{lead.name}</Text>
            <Text style={styles.host.note}>{text}</Text>
          </View>
        );
      })}
    </View>
  );
}
