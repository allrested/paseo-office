import { useCallback, useEffect, useRef } from "react";
import type {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView as NativeScrollView,
} from "react-native";

interface Span {
  x: number;
  width: number;
}

/**
 * Keeps the shown session's tab in view in a strip that scrolls sideways: a tab opened at the end,
 * or chosen from elsewhere, is brought to the strip's edge where it can be seen. The tabs report
 * their own place; a tab that is not wholly in view is scrolled to by its own x.
 */
export function useTabReveal(shown: string | null) {
  const scroller = useRef<NativeScrollView>(null);
  const strip = useRef({ width: 0, offset: 0 });
  const tabs = useRef(new Map<string, Span>());
  const shownNow = useRef(shown);
  shownNow.current = shown;
  const reveal = useCallback((agentId: string) => {
    const tab = tabs.current.get(agentId);
    const { width, offset } = strip.current;
    if (tab === undefined || width === 0) return;
    if (tab.x >= offset && tab.x + tab.width <= offset + width) return;
    scroller.current?.scrollTo({ x: tab.x, animated: true });
  }, []);
  useEffect(() => {
    if (shown !== null) reveal(shown);
  }, [shown, reveal]);
  // A tab opened just now is drawn before it has a place: it is revealed once it reports one.
  const onTabLayout = useCallback(
    (agentId: string, { x, width }: Span) => {
      tabs.current.set(agentId, { x, width });
      if (agentId === shownNow.current) reveal(agentId);
    },
    [reveal],
  );
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      strip.current.width = event.nativeEvent.layout.width;
      if (shownNow.current !== null) reveal(shownNow.current);
    },
    [reveal],
  );
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    strip.current.offset = event.nativeEvent.contentOffset.x;
  }, []);
  return { scroller, onLayout, onScroll, onTabLayout };
}
