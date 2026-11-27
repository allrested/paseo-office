import { useCallback, useRef, useState } from "react";
import type {
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView as NativeScrollView,
} from "react-native";

/** How close to its end the list still counts as at the bottom. */
const BOTTOM_SLACK = 24;

/**
 * A list that stays at its end while the reader is there. Give `scroller` as the list's ref and
 * `onScroll`, `followEnd` as its onScroll, onContentSizeChange and onLayout (a list that shrinks
 * also follows: a bar or the keyboard takes room below it). `away` says the reader has scrolled up,
 * and `toEnd` brings them back to the end from anywhere.
 */
export function useFollowEnd() {
  const atBottom = useRef(true);
  const [away, setAway] = useState(false);
  const scroller = useRef<NativeScrollView>(null);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    atBottom.current =
      contentSize.height - contentOffset.y - layoutMeasurement.height < BOTTOM_SLACK;
    setAway(!atBottom.current);
  }, []);
  const followEnd = useCallback(() => {
    if (atBottom.current) scroller.current?.scrollToEnd({ animated: false });
  }, []);
  const toEnd = useCallback(() => {
    atBottom.current = true;
    setAway(false);
    scroller.current?.scrollToEnd({ animated: false });
  }, []);
  return { scroller, onScroll, followEnd, away, toEnd };
}
