import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";
import { Text } from "./text.js";
import type { OfficeStyles } from "./styles.js";
import { useT } from "./ui-language.js";

export interface SegmentPillProps<Value> {
  /** What a press hands to `onPress`. */
  value: Value;
  /** The button's name. */
  name: string;
  /** What the pill shows; the name when absent. */
  text?: string;
  on: boolean;
  disabled: boolean;
  onPress(value: Value): void;
  styles: OfficeStyles;
}

/**
 * A pill of a row of the view switch's kind, as a button that says whether it is pressed: the
 * chosen one filled, a hovered or pressed one lit.
 */
export function SegmentPill<Value>({
  value,
  name,
  text,
  on,
  disabled,
  onPress,
  styles,
}: SegmentPillProps<Value>) {
  const press = useCallback(() => onPress(value), [onPress, value]);
  const t = useT();
  const [hovered, setHovered] = useState(false);
  const hoverIn = useCallback(() => setHovered(true), []);
  const hoverOut = useCallback(() => setHovered(false), []);
  const [pressed, setPressed] = useState(false);
  const pressIn = useCallback(() => setPressed(true), []);
  const pressOut = useCallback(() => setPressed(false), []);
  let fill = null;
  if (on) fill = styles.segmentFill;
  else if (hovered || pressed) fill = styles.segmentHoverFill;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(name)}
      aria-pressed={on}
      disabled={disabled}
      onPress={press}
      onPressIn={pressIn}
      onPressOut={pressOut}
      onHoverIn={hoverIn}
      onHoverOut={hoverOut}
      style={styles.segment}
    >
      {fill === null ? null : <View style={fill} />}
      <Text style={on ? styles.segmentTextSelected : styles.segmentText}>{t(text ?? name)}</Text>
    </Pressable>
  );
}
