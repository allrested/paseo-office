import { Text } from "./text.js";
import { ExternalLink } from "@getpaseo/plugin/client/ui";
import type { PostSource } from "../shared/contracts.js";
import type { OfficeStyles } from "./styles.js";
import { useT } from "./ui-language.js";

/** A ticket's address is opened only when it is web: a stored one could be anything. */
function isWebAddress(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** What a screen reader calls the chip: where it goes. */
function chipLabel(source: PostSource): string {
  return source.kind === "jira" ? `Open ${source.key} in Jira` : `Open ${source.key} on GitHub`;
}

export interface SourceChipProps {
  source: PostSource;
  styles: OfficeStyles;
}

/**
 * The ticket a task came from, as its key on the task's meta line: a link to the ticket, the way
 * the Reviews card links a pull request. It is not part of the task's own button, so a press on it
 * changes nothing on the board. An address that is not http or https is shown as text.
 */
export function SourceChip({ source, styles }: SourceChipProps) {
  const t = useT();
  if (!isWebAddress(source.url)) return <Text style={styles.postMeta}>{source.key}</Text>;
  return (
    <ExternalLink href={source.url} accessibilityLabel={t(chipLabel(source))}>
      {source.key}
    </ExternalLink>
  );
}
