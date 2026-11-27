import { forwardRef, type ComponentProps } from "react";
import { Text as NativeText } from "react-native";
import { TextInput as PaseoTextInput } from "@getpaseo/plugin/client/ui";
import { useT } from "./ui-language.js";

/**
 * The office's text: react-native's, in the interface's language. A child that is one string is
 * looked up as a whole; anything else (a number, a nested view, text in several parts) is drawn
 * as it is. Every view of the office draws its words through this one.
 */
export function Text({ children, ...props }: ComponentProps<typeof NativeText>) {
  const t = useT();
  return (
    <NativeText {...props}>{typeof children === "string" ? t(children) : children}</NativeText>
  );
}

type InputProps = ComponentProps<typeof PaseoTextInput>;
type InputRef = InputProps extends { ref?: infer Ref } ? Ref : never;

/** The app's text field, with its placeholder and its name in the interface's language. */
export const TextInput = forwardRef(function TextInput(
  { placeholder, accessibilityLabel, ...props }: InputProps,
  ref,
) {
  const t = useT();
  return (
    <PaseoTextInput
      {...props}
      ref={ref as InputRef}
      placeholder={placeholder === undefined ? undefined : t(placeholder)}
      accessibilityLabel={accessibilityLabel === undefined ? undefined : t(accessibilityLabel)}
    />
  );
}) as typeof PaseoTextInput;
