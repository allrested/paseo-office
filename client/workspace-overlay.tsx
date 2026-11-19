import {
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { OfficeModal, useFullscreenDialog } from "./office-modal.js";
import type { OfficeStyles } from "./styles.js";
import { workspaceOverlayUrl } from "./workspace-overlay-route.web.js";

interface WorkspaceOverlayProps {
  dockRequest: object;
  hostId: string;
  workspaceId: string | null;
  agentId: string | null;
  title: string;
  platform: PluginSurfaceProps["layout"]["platform"];
  styles: OfficeStyles;
  onBoard?: () => void;
  onClose(): void;
  children: ReactNode;
}

const FRAME_NAME = "paseo-office-workspace";
const body: ViewStyle = { flex: 1, minHeight: 0, padding: 0, gap: 0 };
const tools: ViewStyle = { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 };
const toolbarSpacing: ViewStyle = { paddingHorizontal: 5, gap: 4 };
const inlineTools: ViewStyle = { paddingVertical: 6, paddingHorizontal: 12 };
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

function ToolbarAction({
  label,
  caption,
  icon,
  selected,
  onPress,
  styles,
}: {
  label: string;
  caption: string;
  icon: string;
  selected?: boolean;
  onPress(): void;
  styles: OfficeStyles;
}) {
  const [hovered, setHovered] = useState(false);
  const enter = useCallback(() => setHovered(true), []);
  const leave = useCallback(() => setHovered(false), []);
  let surface = styles.workspaceAction;
  if (selected) surface = styles.sidebarButtonActive;
  else if (hovered) surface = styles.sidebarButtonHover;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      aria-pressed={selected}
      onHoverIn={enter}
      onHoverOut={leave}
      onPress={onPress}
      style={StyleSheet.compose(surface, toolbarSpacing)}
    >
      <Icon name={icon} size={15} color={selected ? styles.workspaceAccent : styles.iconColor} />
      <Text style={styles.sidebarButtonText}>{caption}</Text>
    </Pressable>
  );
}

/** The embedded workbench and the Office conversation keep their state while a person switches views. */
export function WorkspaceOverlay(props: WorkspaceOverlayProps) {
  const { title, onClose, onBoard, styles, children } = props;
  const url = frameUrl(props);
  const inHeader = useFullscreenDialog();
  const [office, setOffice] = useState(false);
  const [visited, setVisited] = useState(false);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const blocked = url !== null && url === failedUrl;
  const showOffice = !url || office || blocked;
  const change = useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose],
  );
  const openOffice = useCallback(() => {
    setVisited(true);
    setOffice(true);
  }, []);
  const openWorkbench = useCallback(() => {
    setOffice(false);
    setFailedUrl(null);
  }, []);
  const failed = useCallback(() => {
    setFailedUrl(url);
    setVisited(true);
  }, [url]);
  const loaded = useCallback(
    (event: SyntheticEvent<HTMLIFrameElement>) => {
      const doc = event.currentTarget.contentDocument;
      if (!doc || doc.URL === "about:blank") failed();
    },
    [failed],
  );
  const headerIcon = useMemo(
    () => <Icon name="FolderOpen" size={18} color={styles.workspaceAccent} />,
    [styles.workspaceAccent],
  );
  const toolbar = (url || onBoard) && (
    <View role="group" aria-label="Workspace controls" style={tools}>
      {url && (
        <>
          <ToolbarAction
            label="Paseo workspace"
            caption="Workspace"
            icon="PanelsTopLeft"
            selected={!showOffice}
            onPress={openWorkbench}
            styles={styles}
          />
          <ToolbarAction
            label="Office controls"
            caption="Office controls"
            icon="SlidersHorizontal"
            selected={showOffice}
            onPress={openOffice}
            styles={styles}
          />
        </>
      )}
      {onBoard && showOffice && (
        <ToolbarAction
          label="Workspace board"
          caption="Board"
          icon="Columns3"
          onPress={onBoard}
          styles={styles}
        />
      )}
    </View>
  );
  return (
    <OfficeModal
      title={title}
      icon={headerIcon}
      open
      size="wide"
      dockRequest={props.dockRequest}
      onOpenChange={change}
      headerActions={inHeader ? toolbar : undefined}
    >
      <OfficeModal.Content scrollable={false} contentContainerStyle={body}>
        {!inHeader && toolbar && <View style={inlineTools}>{toolbar}</View>}
        {blocked && (
          <Text accessibilityRole="alert" style={styles.fieldHint}>
            This browser couldn’t display the workspace.
          </Text>
        )}
        {url && !blocked && (
          <iframe
            key={url}
            name={FRAME_NAME}
            // oxlint-disable-next-line react/iframe-missing-sandbox -- This frame runs the same trusted Paseo app and needs its paired-host storage.
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads allow-modals"
            title="Paseo workspace"
            src={url}
            style={showOffice ? hiddenFrame : frameStyle}
            allow="clipboard-read 'self'; clipboard-write 'self'"
            onLoad={loaded}
            onError={failed}
          />
        )}
        {(showOffice || visited) && (
          <View style={showOffice ? body : styles.hidden}>{children}</View>
        )}
      </OfficeModal.Content>
    </OfficeModal>
  );
}
