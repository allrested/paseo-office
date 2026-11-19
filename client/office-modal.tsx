import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type SyntheticEvent,
} from "react";
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

type OfficeModalProps = ModalProps & { size?: "standard" | "wide" };

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
  return <Fullscreen.Provider value={appearance}>{children}</Fullscreen.Provider>;
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

function BrowserDialog({
  title,
  icon,
  size,
  onOpenChange,
  children,
  theme: { colors },
}: OfficeModalProps & DialogAppearance) {
  const dialog = useRef<HTMLDialogElement>(null);
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
  );
}

export function OfficeModal({ size, ...props }: OfficeModalProps) {
  const appearance = useContext(Fullscreen);
  if (appearance === null) return <PaseoModal {...props} />;
  return props.open ? <BrowserDialog {...props} size={size} {...appearance} /> : null;
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
