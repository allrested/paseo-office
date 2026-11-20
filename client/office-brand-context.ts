import { useRpc } from "@getpaseo/plugin/client";
import { worldLogoRpc } from "../shared/contracts.js";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
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

/** The web and native scene both receive the same origin-clean logo texture. */
export function useSceneBrand() {
  const brand = useOfficeBrand();
  const configured = useContext(OfficeBrandContext)?.logoUrl;
  const fetchLogo = useRpc(worldLogoRpc);
  const [logo, setLogo] = useState<{ url: string; data: string | null } | null>(null);
  useEffect(() => {
    if (!configured) return;
    let mounted = true;
    const finish = (data: string | null) => {
      if (mounted) setLogo({ url: configured, data });
    };
    void fetchLogo({}).then(
      (reply) => finish(reply?.url === configured ? reply.data : null),
      () => finish(null),
    );
    return () => {
      mounted = false;
    };
  }, [configured, fetchLogo]);
  return useMemo(() => {
    if (!configured) return brand;
    return logo?.url === configured ? { ...brand, logoUrl: logo.data } : null;
  }, [brand, configured, logo]);
}
