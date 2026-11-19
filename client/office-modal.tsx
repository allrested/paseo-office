import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { RegisterWorkspaceDock } from "./world/workspace-dock.js";
import { View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import {
  Icon,
  Modal as PaseoModal,
  ScrollView,
  type ModalProps,
  type ModalContentProps,
} from "@getpaseo/plugin/client/ui";
import type { OfficeStyles } from "./styles.js";

interface DialogAppearance {
  theme: PluginTheme;
  styles: OfficeStyles;
}

type OfficeModalProps = ModalProps & {
  size?: "standard" | "wide" | "settings";
  headerActions?: ReactNode;
  dockRequest?: object;
};

// The stock modal owns its header; on that surface the workspace toolbar belongs in the body.
export function useFullscreenDialog(): boolean {
  return useContext(Fullscreen) !== null;
}

const CameraDock = createContext<HTMLButtonElement | null>(null);
const Fullscreen = createContext<DialogAppearance | null>(null);

// The native dialog's top layer keeps it above the fullscreen scene and its iframe.
const dialogCss = `
.paseo-office-dialog {
  width: min(640px, calc(100% - 32px)); max-width: none; max-height: calc(100% - 32px);
  margin: auto; padding: 0; box-sizing: border-box; overflow: hidden; font-family: inherit;
  border: 1px solid var(--office-border); border-radius: 16px;
  background: var(--office-panel); color: var(--office-text);
  box-shadow: 0 24px 80px rgba(0,0,0,.32), 0 4px 18px rgba(0,0,0,.18);
}
.paseo-office-dialog[data-size="wide"] { width: min(1120px, calc(100% - 32px)); }
.paseo-office-dialog[data-size="wide"] .office-dialog-bounded { height: min(84dvh, 880px); }
.paseo-office-dialog[data-size="settings"] .office-dialog-bounded { height: min(620px, calc(100dvh - 110px)); }
.paseo-office-dialog .office-dialog-tools { min-width: 0; }
.paseo-office-dialog::backdrop { background: rgba(6,10,16,.5); backdrop-filter: blur(3px); }
.paseo-office-dialog .office-dialog-frame {
  display: flex; flex-direction: column; max-height: calc(100dvh - 36px); min-height: 0;
}
.paseo-office-dialog .office-dialog-head {
  flex: none; display: flex; align-items: center; gap: 12px;
  padding: 12px 16px 12px 20px; border-bottom: 1px solid var(--office-border);
}
.paseo-office-dialog .office-dialog-icon {
  flex: none; width: 32px; height: 32px; display: grid; place-items: center;
  border-radius: 9px; background: var(--office-control);
}
.paseo-office-dialog h2 {
  flex: 1; min-width: 0; margin: 0; font: 650 18px/1.3 system-ui,sans-serif;
  letter-spacing: -.02em; overflow-wrap: anywhere;
}
.paseo-office-dialog .office-dialog-close {
  flex: none; display: grid; place-items: center; width: 36px; height: 36px; padding: 0;
  background: transparent; color: var(--office-muted); cursor: pointer;
  border: 1px solid transparent; border-radius: 9px;
}
.paseo-office-dialog .office-dialog-close:hover {
  background: var(--office-control); color: var(--office-text); border-color: var(--office-border);
}
.paseo-office-dialog .office-dialog-close:focus-visible {
  outline: 2px solid var(--office-text); outline-offset: 2px;
}
.paseo-office-dialog .office-dialog-bounded {
  display: flex; flex-direction: column; height: 72dvh; min-height: 0;
}
.office-workspace-dock {
  align-self: stretch; flex: none; display: flex; justify-content: center;
  padding: 5px 12px max(5px, env(safe-area-inset-bottom)); background: var(--office-panel);
  border-top: 1px solid var(--office-border);
}
.office-workspace-dock[hidden] { display: none; }
.office-workspace-dock button {
  max-width: 100%; display: flex; align-items: center; gap: 8px; border-radius: 10px;
  background: var(--office-control); color: var(--office-text); border: 1px solid var(--office-border);
  padding: 7px 12px; cursor: pointer; font: 600 13px/1.4 system-ui,sans-serif;
}
.office-workspace-dock button span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.office-workspace-dock button:hover { border-color: var(--office-muted); }
.office-workspace-dock button:focus-visible { outline: 2px solid var(--office-text); }
@media (max-width: 700px) {
  .paseo-office-dialog[data-size="wide"] .office-dialog-head { flex-wrap: wrap; gap: 6px 8px; }
  .paseo-office-dialog .office-dialog-tools { order: 1; width: 100%; }
}
@media (max-width: 600px), (pointer: coarse) {
  .paseo-office-dialog .office-dialog-close { width: 44px; height: 44px; }
}
@media (max-width: 600px) {
  .paseo-office-dialog, .paseo-office-dialog[data-size="wide"] { width: calc(100% - 16px); max-height: calc(100% - 16px); border-radius: 12px; }
  .paseo-office-dialog .office-dialog-frame { max-height: calc(100dvh - 20px); }
  .paseo-office-dialog .office-dialog-head { padding: 6px 8px 6px 14px; gap: 10px; }
}
`;

export function OfficeDialogs({
  fullscreen,
  theme,
  styles,
  children,
}: DialogAppearance & {
  fullscreen: boolean;
  children: ReactNode;
}) {
  const appearance = useMemo(
    () => (fullscreen ? { theme, styles } : null),
    [fullscreen, theme, styles],
  );
  const [cameraButton, registerDock] = useState<HTMLButtonElement | null>(null);
  return (
    <RegisterWorkspaceDock.Provider value={registerDock}>
      <CameraDock.Provider value={cameraButton}>
        <Fullscreen.Provider value={appearance}>{children}</Fullscreen.Provider>
      </CameraDock.Provider>
    </RegisterWorkspaceDock.Provider>
  );
}

/** Keep Tab inside this dialog even at its edges, where the browser can otherwise focus its toolbar. */
function cycleFocus(event: KeyboardEvent<HTMLDialogElement>): void {
  if (event.key !== "Tab" || event.defaultPrevented) return;
  const dialog = event.currentTarget;
  const items = [
    ...dialog.querySelectorAll<HTMLElement>(
      "button, input, textarea, select, iframe, a[href], [tabindex]",
    ),
  ].filter(
    (item) =>
      item.tabIndex >= 0 &&
      !item.matches(":disabled, [aria-disabled=true]") &&
      item.getClientRects().length > 0,
  );
  const edge = event.shiftKey ? items[0] : items.at(-1);
  if (document.activeElement !== edge) return;
  event.preventDefault();
  const next = event.shiftKey ? items.at(-1) : items[0];
  next?.focus();
}

function dockBounds(button: HTMLButtonElement, page: Document) {
  const bounds = button.getBoundingClientRect();
  if (button.ownerDocument === page) return bounds;
  const frame = button.ownerDocument.defaultView?.frameElement?.getBoundingClientRect();
  return {
    left: (frame?.left ?? 0) + bounds.left,
    top: (frame?.top ?? 0) + bounds.top,
    width: bounds.width,
    height: bounds.height,
  };
}

function BrowserDialog({
  title,
  icon,
  headerActions,
  dockRequest,
  size,
  onOpenChange,
  children,
  theme: { colors },
}: OfficeModalProps & DialogAppearance) {
  const cameraButton = useContext(CameraDock);
  const dialog = useRef<HTMLDialogElement>(null);
  const restoreButton = useRef<HTMLButtonElement>(null);
  const minimizeButton = useRef<HTMLButtonElement>(null);
  const [dockVisible, setDockVisible] = useState(false);
  const [docked, setDocked] = useState<object | null>(null);
  const minimized = !!dockRequest && docked === dockRequest;
  const minimize = useCallback(() => {
    setDockVisible(true);
    setDocked(dockRequest ?? null);
  }, [dockRequest]);
  const restore = useCallback(() => setDocked(null), []);
  const pressedBackdrop = useRef(false);
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  const cancel = useCallback(
    (event: SyntheticEvent) => {
      // The board may interpret Escape as Back from its picker and keep the dialog open.
      event.preventDefault();
      close();
    },
    [close],
  );
  const pointerDown = useCallback((event: PointerEvent<HTMLDialogElement>) => {
    pressedBackdrop.current = event.target === event.currentTarget;
  }, []);
  const clicked = useCallback(
    (event: MouseEvent<HTMLDialogElement>) => {
      if (pressedBackdrop.current && event.target === event.currentTarget) close();
      pressedBackdrop.current = false;
    },
    [close],
  );
  useLayoutEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true });
    };
  }, []);
  useLayoutEffect(() => {
    if (!cameraButton || !dockRequest || !dockVisible) return;
    const label = `Restore ${title}`;
    cameraButton.setAttribute("aria-label", label);
    cameraButton.title = label;
    cameraButton.hidden = false;
    cameraButton.addEventListener("click", restore);
    return () => {
      cameraButton.hidden = true;
      cameraButton.removeEventListener("click", restore);
    };
  }, [cameraButton, dockRequest, dockVisible, restore, title]);
  // Closing a native dialog releases the floor and leaves its iframe and React children mounted.
  const wasMinimized = useRef(false);
  useLayoutEffect(() => {
    const element = dialog.current;
    const button = cameraButton ?? restoreButton.current;
    if (!element || !button || (!minimized && !wasMinimized.current)) return;
    if (minimized && wasMinimized.current && !element.open) return;
    wasMinimized.current = minimized;
    if (!element.open) element.showModal();
    const from = element.getBoundingClientRect();
    const to = dockBounds(button, element.ownerDocument);
    const finish = () => {
      if (minimized) {
        element.close();
        button.focus({ preventScroll: true });
      } else {
        setDockVisible(false);
        minimizeButton.current?.focus({ preventScroll: true });
      }
    };
    if (
      !element.animate ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
      !from.width ||
      !to.width
    ) {
      finish();
      return;
    }
    const x = to.left + to.width / 2 - from.left - from.width / 2;
    const y = to.top + to.height / 2 - from.top - from.height / 2;
    const frames = [
      { transform: "none", opacity: 1 },
      {
        transform: `translate(${x * 0.55}px, ${y * 0.4}px) scale(.70,.58)`,
        opacity: 0.98,
        offset: 0.45,
      },
      {
        transform: `translate(${x}px, ${y}px) scale(${to.width / from.width},${to.height / from.height})`,
        opacity: 0.28,
      },
    ];
    const animation = element.animate(frames, {
      duration: 320,
      easing: "ease-in-out",
      direction: minimized ? "normal" : "reverse",
    });
    animation.onfinish = () => {
      finish();
    };
    return () => {
      animation.onfinish = null;
      animation.cancel();
    };
  }, [minimized, cameraButton]);
  const tokens = useMemo(
    () =>
      ({
        "--office-panel": colors.surface0,
        "--office-control": colors.surface2,
        "--office-border": colors.border,
        "--office-text": colors.foreground,
        "--office-muted": colors.foregroundMuted,
      }) as CSSProperties,
    [colors],
  );
  return (
    <>
      <dialog
        ref={dialog}
        className="paseo-office-dialog"
        data-size={size}
        style={tokens}
        aria-label={title}
        onCancel={cancel}
        onKeyDown={cycleFocus}
        onPointerDown={pointerDown}
        onClick={clicked}
      >
        <style>{dialogCss}</style>
        <div className="office-dialog-frame">
          <header className="office-dialog-head">
            {icon && (
              <span className="office-dialog-icon" aria-hidden>
                {icon}
              </span>
            )}
            <h2>{title}</h2>
            {headerActions && <div className="office-dialog-tools">{headerActions}</div>}
            {dockRequest && (
              <button
                ref={minimizeButton}
                type="button"
                className="office-dialog-close"
                aria-label="Minimize workspace"
                title="Minimize workspace"
                onClick={minimize}
              >
                <Icon name="Minus" size={18} color="currentColor" />
              </button>
            )}
            <button
              type="button"
              className="office-dialog-close"
              aria-label={`Close ${title}`}
              title="Close"
              onClick={close}
            >
              <Icon name="X" size={18} color="currentColor" />
            </button>
          </header>
          {children}
        </div>
      </dialog>
      {dockRequest && (
        <div
          role="toolbar"
          aria-label="Minimized workspaces"
          className="office-workspace-dock"
          style={tokens}
          hidden={!dockVisible || !!cameraButton}
        >
          <button
            ref={restoreButton}
            type="button"
            aria-label={`Restore ${title}`}
            title={`Restore ${title}`}
            onClick={restore}
          >
            <Icon name="PanelsTopLeft" size={16} color="currentColor" />
            <span>{title}</span>
          </button>
        </div>
      )}
    </>
  );
}

export function OfficeModal({ size, headerActions, dockRequest, ...props }: OfficeModalProps) {
  const appearance = useContext(Fullscreen);
  if (appearance === null) return <PaseoModal {...props} />;
  return props.open ? (
    <BrowserDialog
      {...props}
      size={size}
      headerActions={headerActions}
      dockRequest={dockRequest}
      {...appearance}
    />
  ) : null;
}

OfficeModal.Content = function Content({
  children,
  scrollable = true,
  style,
  contentContainerStyle,
}: ModalContentProps) {
  const appearance = useContext(Fullscreen);
  const bodyStyle = useMemo(
    () => [appearance?.styles.dialogBody, contentContainerStyle],
    [appearance, contentContainerStyle],
  );
  const boundedBodyStyle = useMemo(
    () => [appearance?.styles.columnBody, bodyStyle, style],
    [appearance, bodyStyle, style],
  );
  if (appearance === null) {
    return (
      <PaseoModal.Content
        scrollable={scrollable}
        style={style}
        contentContainerStyle={contentContainerStyle}
      >
        {children}
      </PaseoModal.Content>
    );
  }
  if (scrollable)
    return (
      <ScrollView style={style} contentContainerStyle={bodyStyle}>
        {children}
      </ScrollView>
    );
  return (
    <div className="office-dialog-bounded">
      <View style={boundedBodyStyle}>{children}</View>
    </div>
  );
};
