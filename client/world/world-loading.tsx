import { Text, View } from "react-native";
import type { OfficeStyles } from "../styles.js";

/** The 3D view's place while the host's plan is not known: nothing is started yet. */
export function WorldLoading({ styles }: { styles: OfficeStyles }) {
  return (
    <View style={styles.scene}>
      <Text style={styles.sceneStatus}>Loading the 3D view...</Text>
    </View>
  );
}
