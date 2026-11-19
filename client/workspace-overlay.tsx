import {
  useCallback,
  useState,
  type CSSProperties,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { Text, View, type ViewStyle } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { OfficeModal } from "./office-modal.js";
import { SegmentPill } from "./segment-pill.js";
import type { OfficeStyles } from "./styles.js";
import { workspaceOverlayUrl } from "./workspace-overlay-route.web.js";

export interface WorkspaceOverlayProps {
  open: boolean;
  hostId: string;
  workspaceId: string | null;
  agentId: string | null;
  title: string;
  platform: PluginSurfaceProps["layout"]["platform"];
  styles: OfficeStyles;
  onClose(): void;
  /** The same host's SDK-backed controls, including on native. */
  children: ReactNode;
}

const FRAME_NAME = "paseo-office-workspace";
const modes = [
  { value: "workspace", name: "Paseo workspace" },
  { value: "office", name: "Office controls" },
] as const;
type Mode = (typeof modes)[number]["value"];
const body: ViewStyle = { flex: 1, minHeight: 0, padding: 0, gap: 0 };
const tools: ViewStyle = { alignItems: "flex-start", paddingHorizontal: 12, paddingVertical: 6 };
const frameStyle: CSSProperties = { width: "100%", flex: 1, minHeight: 0, border: 0 };
const hiddenFrame: CSSProperties = { display: "none" };

function frameUrl({
  platform,
  hostId,
  workspaceId,
  agentId,
}: WorkspaceOverlayProps): string | null {
  if (platform !== "web" || typeof window === "undefined" || window.name === FRAME_NAME)
    return null;
  return workspaceOverlayUrl(new URL(window.location.href), hostId, workspaceId, agentId);
}

function WorkspaceBody({
  url,
  fallback,
  styles,
}: {
  url: string | null;
  fallback: ReactNode;
  styles: OfficeStyles;
}) {
  const [mode, setMode] = useState<Mode>("workspace");
  const [blocked, setBlocked] = useState(false);
  const failed = useCallback(() => {
    setBlocked(true);
    setMode("office");
  }, []);
  const loaded = useCallback(
    (event: SyntheticEvent<HTMLIFrameElement>) => {
      // Browsers fire load even for a frame the server refused to embed.
      const doc = event.currentTarget.contentDocument;
      if (!doc || doc.URL === "about:blank") failed();
    },
    [failed],
  );
  const select = useCallback((next: Mode) => {
    setBlocked(false);
    setMode(next);
  }, []);
  if (url === null) return fallback;
  return (
    <>
      <View style={tools}>
        <View role="group" aria-label="Workspace controls" style={styles.segments}>
          {modes.map(({ value, name }) => (
            <SegmentPill
              key={value}
              value={value}
              name={name}
              on={mode === value}
              disabled={false}
              onPress={select}
              styles={styles}
            />
          ))}
        </View>
        {blocked ? (
          <Text accessibilityRole="alert" style={styles.fieldHint}>
            This browser couldn’t display the workspace.
          </Text>
        ) : null}
      </View>
      {!blocked && (
        <iframe
          name={FRAME_NAME}
          // oxlint-disable-next-line react/iframe-missing-sandbox -- This frame runs the same trusted Paseo app and needs its paired-host storage.
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads allow-modals"
          title="Paseo workspace"
          src={url}
          style={mode === "workspace" ? frameStyle : hiddenFrame}
          allow="clipboard-read 'self'; clipboard-write 'self'"
          onLoad={loaded}
          onError={failed}
        />
      )}
      {mode === "office" && fallback}
    </>
  );
}

/** A real Paseo workbench above the office. The workspace owns its layout, terminals and session drafts. */
export function WorkspaceOverlay(props: WorkspaceOverlayProps) {
  const { open, onClose, title, styles, children } = props;
  const change = useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose],
  );
  if (!open) return null;
  const url = frameUrl(props);
  return (
    <OfficeModal title={title} open size="wide" onOpenChange={change}>
      <OfficeModal.Content scrollable={false} contentContainerStyle={body}>
        <WorkspaceBody key={url} url={url} fallback={children} styles={styles} />
      </OfficeModal.Content>
    </OfficeModal>
  );
}
