import { useCallback, useMemo, useState } from "react";
import { Image } from "react-native";
import { Icon } from "@getpaseo/plugin/client/ui";
import type { OfficeBrand } from "./brand.js";

const brandImage = { width: 24, height: 24 };

export function OfficeMark({
  brand,
  fallbackColor,
}: {
  brand: OfficeBrand;
  fallbackColor: string;
}) {
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const logo = useMemo(() => (brand.logoUrl ? { uri: brand.logoUrl } : null), [brand.logoUrl]);
  const failed = useCallback(() => setFailedLogo(brand.logoUrl), [brand.logoUrl]);
  return logo && failedLogo !== brand.logoUrl ? (
    <Image
      accessible={false}
      source={logo}
      resizeMode="contain"
      style={brandImage}
      onError={failed}
    />
  ) : (
    <Icon name="Building2" size={20} color={brand.color ?? fallbackColor} />
  );
}
