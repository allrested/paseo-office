import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon, TextInput } from "@getpaseo/plugin/client/ui";
import { useRpc } from "@getpaseo/plugin/client";
import { vaultReportRpc, vaultSearchRpc, vaultTalkRpc } from "../shared/contracts.js";
import {
  RULE_TEXT,
  type PromptReport,
  type VaultHit,
  type VaultMessage,
  type VaultTalk,
} from "../shared/vault.js";
import { ActionButton } from "./action-button.js";
import { OfficeModal as Modal } from "./office-modal.js";
import { SegmentPill } from "./segment-pill.js";
import type { OfficeStyles } from "./styles.js";

type Tab = "search" | "report";

const OFF =
  "The history vault is off. With History vault on in the office's settings, the office keeps what is said in each conversation in a file on this host, and it can be searched here.";

const layout = StyleSheet.create({
  search: { flexDirection: "row", alignItems: "center", gap: 8 },
  field: { flex: 1 },
  list: { gap: 12 },
  hit: { gap: 2 },
  head: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  rule: { gap: 3 },
});

function whenText(at: number): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const WHO = { user: "You", assistant: "Agent" } as const;

function Hit({
  hit,
  onOpen,
  styles,
}: {
  hit: VaultHit;
  onOpen(agentId: string): void;
  styles: OfficeStyles;
}) {
  const press = useCallback(() => onOpen(hit.agentId), [onOpen, hit.agentId]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${hit.name}, ${whenText(hit.at)}: ${hit.snippet}`}
      onPress={press}
      style={layout.hit}
    >
      <View style={layout.head}>
        <Text style={styles.host.name} numberOfLines={1}>
          {hit.name}
        </Text>
        <Text style={styles.host.note}>
          {hit.team} · {whenText(hit.at)}
        </Text>
      </View>
      <Text style={styles.host.note}>
        {WHO[hit.role]}: {hit.snippet}
      </Text>
    </Pressable>
  );
}

function Message({ message, styles }: { message: VaultMessage; styles: OfficeStyles }) {
  return (
    <View style={layout.hit}>
      <Text style={styles.host.note}>
        {WHO[message.role]} · {whenText(message.at)}
      </Text>
      <Text selectable style={styles.rowMeta}>
        {message.text}
      </Text>
    </View>
  );
}

function Talk({ talk, onBack, styles }: { talk: VaultTalk; onBack(): void; styles: OfficeStyles }) {
  return (
    <View style={styles.host.body}>
      <View style={layout.head}>
        <Text accessibilityRole="header" style={styles.host.title}>
          {talk.name} · {talk.team}
        </Text>
        <ActionButton label="Back" pendingLabel="Back" onPress={onBack} styles={styles} />
      </View>
      <View style={layout.list}>
        {talk.messages.map((message) => (
          <Message key={`${message.at}:${message.role}`} message={message} styles={styles} />
        ))}
      </View>
    </View>
  );
}

function Report({ report, styles }: { report: PromptReport; styles: OfficeStyles }) {
  if (report.total === 0) {
    return <Text style={styles.host.empty}>No prompt of the last seven days is in the vault.</Text>;
  }
  return (
    <View style={styles.host.body}>
      <Text style={styles.host.title}>
        {report.clean} of {report.total} prompts had nothing to improve
      </Text>
      <View style={layout.list}>
        {report.rules.map((entry) => (
          <View key={entry.rule} style={layout.rule}>
            <Text style={styles.host.name}>
              {RULE_TEXT[entry.rule].title}: {entry.count}
            </Text>
            <Text style={styles.host.note}>{RULE_TEXT[entry.rule].advice}</Text>
            {entry.examples.map((example, index) => (
              // (two prompts of the same words are two examples)
              // oxlint-disable-next-line react/no-array-index-key
              <Text key={`${index}:${example}`} style={styles.rowMeta}>
                “{example}”
              </Text>
            ))}
          </View>
        ))}
      </View>
      <Text style={styles.host.note}>
        The prompt helper&apos;s rules, applied on this host to the prompts of the last seven days
        that are in the vault. No model reads them.
      </Text>
    </View>
  );
}

interface Found {
  on: boolean;
  hits: VaultHit[];
  query: string;
}

function problemOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The search: what was asked last, what it found, and the conversation that is open. */
function useVaultSearch() {
  const search = useRpc(vaultSearchRpc);
  const read = useRpc(vaultTalkRpc);
  const [draft, setDraft] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [talk, setTalk] = useState<VaultTalk | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = useCallback(async () => {
    const query = draft.trim();
    setProblem(null);
    try {
      const answer = await search({ query });
      setFound({ ...answer, query });
    } catch (error) {
      setProblem(`The vault cannot be searched: ${problemOf(error)}`);
    }
  }, [draft, search]);
  const open = useCallback(
    (agentId: string) => {
      setProblem(null);
      read({ agentId }).then(
        (answer) => {
          if (answer.talk === null) setProblem("That conversation is no longer in the vault.");
          else setTalk(answer.talk);
          return undefined;
        },
        (error: unknown) => setProblem(`The conversation cannot be read: ${problemOf(error)}`),
      );
    },
    [read],
  );
  const back = useCallback(() => setTalk(null), []);
  return { draft, setDraft, found, talk, problem, submit, open, back };
}

function Search({ styles }: { styles: OfficeStyles }) {
  const { draft, setDraft, found, talk, problem, submit, open, back } = useVaultSearch();
  const submitNow = useCallback(() => void submit(), [submit]);
  const field = useMemo(() => [styles.fieldInput, layout.field], [styles]);
  if (talk !== null) return <Talk talk={talk} onBack={back} styles={styles} />;
  return (
    <View style={styles.host.body}>
      <View style={layout.search}>
        <TextInput
          accessibilityLabel="Search the history"
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={submitNow}
          placeholder="Words said in a conversation"
          autoCapitalize="none"
          autoCorrect={false}
          style={field}
        />
        <ActionButton
          label="Find"
          pendingLabel="Finding..."
          onPress={submit}
          disabled={draft.trim() === ""}
          styles={styles}
          primary
        />
      </View>
      {problem && (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {problem}
        </Text>
      )}
      {found !== null && !found.on && <Text style={styles.host.empty}>{OFF}</Text>}
      {found !== null && found.on && found.hits.length === 0 && (
        <Text style={styles.host.empty}>Nothing in the vault has “{found.query}”.</Text>
      )}
      {found !== null && found.hits.length > 0 && (
        <View style={layout.list}>
          {found.hits.map((hit) => (
            <Hit
              key={`${hit.agentId}:${hit.at}:${hit.role}`}
              hit={hit}
              onOpen={open}
              styles={styles}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function ReportTab({ styles }: { styles: OfficeStyles }) {
  const ask = useRpc(vaultReportRpc);
  // Kept in a ref: the report is read once when the tab shows, whatever the call's identity.
  const asking = useRef(ask);
  asking.current = ask;
  const [read, setRead] = useState<{ on: boolean; report: PromptReport } | string | null>(null);
  useEffect(() => {
    let ended = false;
    asking.current({}).then(
      (answer) => {
        if (!ended) setRead(answer);
        return undefined;
      },
      (error: unknown) => {
        if (!ended) setRead(`The report cannot be read: ${problemOf(error)}`);
      },
    );
    return () => {
      ended = true;
    };
  }, []);
  if (read === null) return <Text style={styles.host.empty}>Reading the prompts...</Text>;
  if (typeof read === "string") {
    return (
      <Text accessibilityRole="alert" style={styles.actionError}>
        {read}
      </Text>
    );
  }
  if (!read.on) return <Text style={styles.host.empty}>{OFF}</Text>;
  return <Report report={read.report} styles={styles} />;
}

export interface VaultCardProps {
  open: boolean;
  styles: OfficeStyles;
  onClose(): void;
}

/** The history vault: a search of what was said, and the week's prompts against the prompt helper's rules. */
export function VaultCard({ open, styles, onClose }: VaultCardProps) {
  const [tab, setTab] = useState<Tab>("search");
  const change = useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose],
  );
  const icon = useMemo(
    () => <Icon name="Archive" size={18} color={String(styles.host.label.color)} />,
    [styles],
  );
  return (
    <Modal icon={icon} title="History" open={open} onOpenChange={change}>
      <Modal.Content>
        {open && (
          <View style={styles.host.body}>
            <View role="group" aria-label="History" style={styles.segments}>
              <SegmentPill<Tab>
                value="search"
                name="Search"
                on={tab === "search"}
                disabled={false}
                onPress={setTab}
                styles={styles}
              />
              <SegmentPill<Tab>
                value="report"
                name="Prompt report"
                on={tab === "report"}
                disabled={false}
                onPress={setTab}
                styles={styles}
              />
            </View>
            {tab === "search" ? <Search styles={styles} /> : <ReportTab styles={styles} />}
          </View>
        )}
      </Modal.Content>
    </Modal>
  );
}
