import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Image, Pressable, View } from "react-native";
import { Text } from "./text.js";
import { useRpc } from "@getpaseo/plugin/client";
import { sentImageRpc } from "../shared/contracts.js";
import type { OfficeStyles } from "./styles.js";

type Loaded = string | null;

// A sent image's file is named by its hash, so what a URL holds never changes: one read each.
const loaded = new Map<string, Promise<Loaded>>();

function useSentImage(url: string): Loaded | undefined {
  const read = useRpc(sentImageRpc);
  const [data, setData] = useState<Loaded | undefined>(undefined);
  useEffect(() => {
    let mounted = true;
    let pending = loaded.get(url);
    if (!pending) {
      pending = read({ url }).then(
        (reply) => reply.data,
        () => null,
      );
      loaded.set(url, pending);
      // A failed read may be the host restarting: the next mount asks again.
      void pending.then((result) => {
        if (result === null) loaded.delete(url);
        return result;
      });
    }
    void pending.then((result) => {
      if (mounted) setData(result);
      return result;
    });
    return () => {
      mounted = false;
    };
  }, [read, url]);
  return data;
}

const SentImage = memo(function SentImage({
  url,
  position,
  styles,
}: {
  url: string;
  position: string;
  styles: OfficeStyles;
}) {
  const s = styles.transcript;
  const data = useSentImage(url);
  const [wide, setWide] = useState(false);
  const toggle = useCallback(() => setWide((current) => !current), []);
  const source = useMemo(() => ({ uri: data ?? "" }), [data]);
  const sized = useMemo(() => [s.image, s.imageWide], [s.image, s.imageWide]);
  if (data === null)
    return <Text style={s.imageNote}>Image {position} is no longer on the host.</Text>;
  if (data === undefined)
    return <View accessibilityLabel={`Image ${position}, loading`} style={s.image} />;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Image ${position}, ${wide ? "show smaller" : "show larger"}`}
      onPress={toggle}
      style={wide ? s.imageWide : undefined}
    >
      <Image
        accessibilityIgnoresInvertColors
        resizeMode={wide ? "contain" : "cover"}
        source={source}
        style={wide ? sized : s.image}
      />
    </Pressable>
  );
});

/** The images sent with a message, read from the host's copies. A press shows one larger. */
export function SentImages({ urls, styles }: { urls: readonly string[]; styles: OfficeStyles }) {
  // The same image attached twice is one file.
  const unique = [...new Set(urls)];
  return (
    <View style={styles.transcript.images}>
      {unique.map((url, index) => (
        <SentImage
          key={url}
          url={url}
          position={unique.length > 1 ? `${index + 1} of ${unique.length}` : "1"}
          styles={styles}
        />
      ))}
    </View>
  );
}
