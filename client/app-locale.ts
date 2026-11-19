import { defineTranslations, useTranslation } from "@getpaseo/plugin/client";

// The SDK gives a plugin the app's language only through its translation hook, which needs a messages object. This one
// has a single English message and is never shown: only the hook's `locale` is read. It is made on first use, not at
// load: `defineTranslations` calls `Intl.getCanonicalLocales`, and a throw while the client bundle loads fails the
// whole plugin on an engine that lacks it.
const makeProbe = () => defineTranslations({ resources: { en: { probe: "probe" } } });
let probe: ReturnType<typeof makeProbe> | undefined;

/** The app's locale as Paseo names it ("en", "pt-BR", "zh-CN"); the surface renders again when it changes. */
export function useAppLocale(): string {
  probe ??= makeProbe();
  return useTranslation(probe).locale;
}
