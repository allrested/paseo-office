import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Keyboard, type KeyboardEvent, type View } from "react-native";

/** Reserve only the part of the Office surface that the host still draws behind the keyboard. */
export function useChatKeyboard(
  root: RefObject<View | null>,
  platform: "web" | "ios" | "android",
  active: boolean,
) {
  const [inset, setInset] = useState(0);
  const [visible, setVisible] = useState(false);
  const onLayout = useRef<() => void>(() => {});
  const measureKeyboard = useCallback(() => onLayout.current(), []);

  useEffect(() => {
    setInset(0);
    setVisible(false);
    if (!active) return;
    if (platform === "web") {
      const viewport = window.visualViewport;
      if (!viewport) return;
      const measure = () => {
        const box = (root.current as unknown as HTMLElement | null)?.getBoundingClientRect();
        setVisible(viewport.height + viewport.offsetTop < window.innerHeight - 80);
        if (box) setInset(Math.max(0, box.bottom - viewport.offsetTop - viewport.height));
      };
      onLayout.current = measure;
      viewport.addEventListener("resize", measure);
      viewport.addEventListener("scroll", measure);
      measure();
      return () => {
        onLayout.current = () => {};
        viewport.removeEventListener("resize", measure);
        viewport.removeEventListener("scroll", measure);
      };
    }

    let top = Keyboard.metrics()?.screenY;
    let revision = 0;
    const measure = () => {
      const current = ++revision;
      const keyboardTop = top;
      setVisible(keyboardTop !== undefined);
      if (keyboardTop === undefined) {
        setInset(0);
        return;
      }
      root.current?.measureInWindow((_x, y, _width, height) => {
        if (current === revision) setInset(Math.max(0, y + height - keyboardTop));
      });
    };
    const shown = (event: KeyboardEvent) => {
      top = event.endCoordinates.screenY;
      measure();
    };
    const hidden = () => {
      top = undefined;
      measure();
    };
    const show = Keyboard.addListener(
      platform === "ios" ? "keyboardWillChangeFrame" : "keyboardDidShow",
      shown,
    );
    const hide = Keyboard.addListener(
      platform === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      hidden,
    );
    onLayout.current = measure;
    measure();
    return () => {
      revision++;
      onLayout.current = () => {};
      show.remove();
      hide.remove();
    };
  }, [active, platform, root]);
  const spaceStyle = useMemo(() => ({ height: active ? inset : 0 }), [active, inset]);
  return { spaceStyle, measureKeyboard, visible: active && visible };
}
