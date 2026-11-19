import { createContext, useContext, useMemo } from "react";
import type { Branding } from "../shared/branding.js";
import { readBrand } from "./web-env.web.js";

export const OfficeBrandContext = createContext<Branding | undefined>(undefined);

export function useOfficeBrand() {
  const brand = useContext(OfficeBrandContext);
  const name = brand?.name;
  const logoUrl = brand?.logoUrl;
  const color = brand?.color;
  return useMemo(() => {
    const page = readBrand();
    return { name: name ?? page?.name ?? null, logoUrl: logoUrl ?? page?.logoUrl ?? null, color };
  }, [name, logoUrl, color]);
}
