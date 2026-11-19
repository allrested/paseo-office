import type { SetStateAction } from "react";
import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import type { ChatImage, ChatMessage } from "../shared/contracts.js";
import type { NewAgentChoice } from "./new-agent-model.js";
import type { OfficeStyles } from "./styles.js";
import type { OfficeState } from "./use-office.js";

/** What a panel of the column asks of the surface it is drawn in. */
export interface OfficeLink {
  /** Opens the agent's card, as a press on a List row does. */
  select(agentId: string): void;
  /** Shows the agent's session. */
  openSession(agentId: string): void;
  /** Shows the agent's workspace over the office; absent where the surface has no such view. */
  openWorkspace?(agentId: string): void;
}

/** What the surface hands each panel of its column. */
export interface ColumnPanelProps {
  /** The surface's one subscription to the office. */
  office: OfficeState;
  styles: OfficeStyles;
  theme: PluginTheme;
  layout: PluginSurfaceProps["layout"];
  link: OfficeLink;
  /** The Sessions tab's New agent form, kept by the surface. */
  newAgent: NewAgentDraft;
}

/** What is typed in the chat's box and what it replies to: the surface's, so a tab switch keeps it. */
export interface ChatDraft {
  text: string;
  /** Takes an updater as well: a send that returns keeps what was typed while it was away. */
  setText(next: SetStateAction<string>): void;
  replyTo: ChatMessage | null;
  setReplyTo(next: ChatMessage | null): void;
  recipient: string | null;
  setRecipient(agentId: string | null): void;
  images: (ChatImage & { id: number; name: string })[];
  setImages(next: SetStateAction<ChatDraft["images"]>): void;
}

/**
 * The Sessions tab's New agent form: whether it is open and what is chosen and typed in it. The
 * surface's, so another tab or a dismissed sheet keeps it while the office is mounted.
 */
export interface NewAgentDraft {
  open: boolean;
  setOpen(next: boolean): void;
  choice: NewAgentChoice;
  change(patch: Partial<NewAgentChoice>): void;
}
