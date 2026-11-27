import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Text } from "./text.js";
import { Markdown } from "@getpaseo/plugin/client/ui";
import { TextInput } from "./text.js";
import type { OfficePermission } from "../shared/contracts.js";
import { ActionButton } from "./action-button.js";
import {
  DISMISSED,
  NO_PICKS,
  answerResponse,
  answered,
  pick,
  planResponse,
  readAsk,
  type Ask,
  type AskAction,
  type AskPicks,
  type AskQuestion,
  type AskResponse,
} from "./ask-form.js";
import { SegmentPill } from "./segment-pill.js";
import type { OfficeStyles } from "./styles.js";
import type { AgentActions } from "./use-agent-actions.js";

export const PLAN_CUT = "The plan goes on: the workspace has the rest.";
export const FEEDBACK_HINT = "What to change, sent with a refusal";

/** The request behind a plan or a question; null while it is read, and where it cannot be. */
function useAsk(agentId: string, requestId: string, actions: AgentActions): Ask | null {
  const [ask, setAsk] = useState<Ask | null>(null);
  const { pending } = actions;
  useEffect(() => {
    let current = true;
    setAsk(null);
    if (pending === undefined) return undefined;
    void (async () => {
      try {
        const request = await pending(agentId, requestId);
        if (current) setAsk(readAsk(request));
      } catch {
        // Left unread: the card keeps the words that say where to answer it.
      }
    })();
    return () => {
      current = false;
    };
  }, [agentId, requestId, pending]);
  return ask;
}

interface PlanProps {
  ask: Extract<Ask, { kind: "plan" }>;
  send(response: AskResponse): Promise<void>;
  styles: OfficeStyles;
}

function PlanAction({
  action,
  feedback,
  send,
  styles,
}: {
  action: AskAction;
  feedback: string;
  send: PlanProps["send"];
  styles: OfficeStyles;
}) {
  const press = useCallback(() => send(planResponse(action, feedback)), [send, action, feedback]);
  return (
    <ActionButton
      label={action.label}
      pendingLabel={action.label}
      onPress={press}
      primary={action.behavior === "allow"}
      styles={styles}
    />
  );
}

function PlanForm({ ask, send, styles }: PlanProps) {
  const [feedback, setFeedback] = useState("");
  return (
    <>
      <Markdown>{ask.plan}</Markdown>
      {ask.cut ? <Text style={styles.muted}>{PLAN_CUT}</Text> : null}
      <TextInput
        accessibilityLabel="What to change in the plan"
        placeholder={FEEDBACK_HINT}
        value={feedback}
        onChangeText={setFeedback}
        multiline
        style={styles.fieldInput}
      />
      <View style={styles.actions}>
        {ask.actions.map((action) => (
          <PlanAction
            key={action.id}
            action={action}
            feedback={feedback}
            send={send}
            styles={styles}
          />
        ))}
      </View>
    </>
  );
}

interface QuestionProps {
  question: AskQuestion;
  at: number;
  picks: AskPicks;
  onPicks(next: AskPicks): void;
  styles: OfficeStyles;
}

function Question({ question, at, picks, onPicks, styles }: QuestionProps) {
  const choose = useCallback(
    (option: number) => onPicks(pick(picks, question, at, option)),
    [onPicks, picks, question, at],
  );
  const type = useCallback(
    (text: string) => onPicks({ ...picks, typed: { ...picks.typed, [at]: text } }),
    [onPicks, picks, at],
  );
  const chosen = picks.chosen[at] ?? [];
  return (
    <View style={styles.headerField}>
      <Text style={styles.sheetLabel}>{question.header}</Text>
      <Text style={styles.permissionDetail}>{question.question}</Text>
      {question.options.length === 0 ? null : (
        <View role="group" aria-label={question.header} style={styles.notesDays}>
          {question.options.map((option, index) => (
            <SegmentPill
              key={option.label}
              value={index}
              name={option.label}
              on={chosen.includes(index)}
              disabled={false}
              onPress={choose}
              styles={styles}
            />
          ))}
        </View>
      )}
      {question.options.map((option, index) =>
        option.description !== null && chosen.includes(index) ? (
          <Text key={option.label} style={styles.fieldHint}>
            {option.description}
          </Text>
        ) : null,
      )}
      {question.typed ? (
        <TextInput
          accessibilityLabel={`Your answer to ${question.header}`}
          placeholder={question.options.length === 0 ? "Your answer" : "Another answer"}
          value={picks.typed[at] ?? ""}
          onChangeText={type}
          style={styles.fieldInput}
        />
      ) : null}
    </View>
  );
}

interface FormProps {
  ask: Extract<Ask, { kind: "question" }>;
  send(response: AskResponse): Promise<void>;
  styles: OfficeStyles;
}

function QuestionForm({ ask, send, styles }: FormProps) {
  const [picks, setPicks] = useState(NO_PICKS);
  const submit = useCallback(() => send(answerResponse(ask, picks)), [send, ask, picks]);
  const dismiss = useCallback(() => send(DISMISSED), [send]);
  return (
    <>
      {ask.questions.map((question, at) => (
        <Question
          key={question.header}
          question={question}
          at={at}
          picks={picks}
          onPicks={setPicks}
          styles={styles}
        />
      ))}
      <View style={styles.actions}>
        <ActionButton
          label="Send answers"
          pendingLabel="Sending..."
          onPress={submit}
          disabled={!answered(ask.questions, picks)}
          primary
          styles={styles}
        />
        <ActionButton
          label="Dismiss"
          pendingLabel="Dismissing..."
          onPress={dismiss}
          styles={styles}
        />
      </View>
    </>
  );
}

export interface AskCardProps {
  agentId: string;
  permission: OfficePermission;
  actions: AgentActions;
  /** What the card says while the request cannot be answered here. */
  fallback: string;
  styles: OfficeStyles;
}

/**
 * A plan or a question, answered where the session is shown: the plan with the request's own
 * actions and a line of what to change, the question as its form. While the request is read, and
 * on a host or for a shape it cannot be read from, the card says where to answer it.
 */
export function AskCard({ agentId, permission, actions, fallback, styles }: AskCardProps) {
  const ask = useAsk(agentId, permission.id, actions);
  const { answer } = actions;
  // One answer per request, as Approve and Deny: a second press while one is on its way does nothing.
  const sending = useRef(false);
  const send = useCallback(
    async (response: AskResponse) => {
      if (answer === undefined || sending.current) return;
      sending.current = true;
      try {
        await answer(agentId, permission.id, response);
      } finally {
        sending.current = false;
      }
    },
    [answer, agentId, permission.id],
  );
  const form = ask !== null && answer !== undefined;
  return (
    <View style={styles.permission}>
      <Text style={styles.permissionTitle}>{permission.title}</Text>
      {form && ask.kind === "plan" ? <PlanForm ask={ask} send={send} styles={styles} /> : null}
      {form && ask.kind === "question" ? (
        <QuestionForm ask={ask} send={send} styles={styles} />
      ) : null}
      {form ? null : (
        <>
          {permission.detail === undefined ? null : (
            <Text style={styles.permissionDetail} numberOfLines={4}>
              {permission.detail}
            </Text>
          )}
          <Text style={styles.muted}>{fallback}</Text>
        </>
      )}
    </View>
  );
}
