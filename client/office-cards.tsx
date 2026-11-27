import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";
import { Text } from "./text.js";
import { Icon } from "@getpaseo/plugin/client/ui";
import type { StripCard } from "./attention-strip.js";
import { OfficeModal as Modal } from "./office-modal.js";
import type { OfficeStyles } from "./styles.js";

/** A card of the office with the icon it is listed under. */
export interface OfficeCard extends StripCard {
  icon: string;
}

interface CardRowProps {
  card: OfficeCard;
  color: string;
  onOpen(card: OfficeCard): void;
  styles: OfficeStyles;
}

function CardRow({ card, color, onOpen, styles }: CardRowProps) {
  const [hovered, setHovered] = useState(false);
  const hoverIn = useCallback(() => setHovered(true), []);
  const hoverOut = useCallback(() => setHovered(false), []);
  const press = useCallback(() => onOpen(card), [onOpen, card]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${card.title}: ${card.note.text}`}
      onPress={press}
      onHoverIn={hoverIn}
      onHoverOut={hoverOut}
      style={hovered ? styles.officeCardRowHover : styles.officeCardRow}
    >
      <Icon name={card.icon} size={18} color={color} />
      <View style={styles.officeCardText}>
        <Text style={styles.skillName}>{card.title}</Text>
        <Text style={styles.stripNote[card.note.tone]}>{card.note.text}</Text>
      </View>
      <Icon name="ChevronRight" size={16} color={styles.placeholderColor} />
    </Pressable>
  );
}

export interface OfficeCardsDialogProps {
  cards: readonly OfficeCard[];
  open: boolean;
  /** The theme's foreground, for the rows' icons. */
  color: string;
  onClose(): void;
  styles: OfficeStyles;
}

/**
 * The office's own cards by name, each with what it says now. A press closes the list and opens
 * the card, so the card's own dialog is not drawn over this one.
 */
export function OfficeCardsDialog({ cards, open, color, onClose, styles }: OfficeCardsDialogProps) {
  const change = useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose],
  );
  const pick = useCallback(
    (card: OfficeCard) => {
      onClose();
      card.onOpen();
    },
    [onClose],
  );
  return (
    <Modal title="Office" open={open} onOpenChange={change}>
      <Modal.Content>
        <View style={styles.pickerRows}>
          {cards.map((card) => (
            <CardRow key={card.title} card={card} color={color} onOpen={pick} styles={styles} />
          ))}
        </View>
      </Modal.Content>
    </Modal>
  );
}
