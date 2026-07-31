import { usePiDeskStore } from "../store/pidesk";
import { common } from "./domains/common";
import { sidebar } from "./domains/sidebar";
import {
  topbar, composer, conversation, toast,
  settings, inspector, statusbar, console as consoleDomain, dialog,
} from "./domains/ui";

type Lang = "zh" | "en";

const domains: Record<string, { zh: Record<string, string>; en: Record<string, string> }> = {
  common,
  sidebar,
  topbar,
  composer,
  conversation,
  toast,
  settings,
  inspector,
  statusbar,
  console: consoleDomain,
  dialog,
};

/** Reactive i18n hook. Use: const { t } = useT("sidebar"); */
export function useT(domain: string) {
  const lang = usePiDeskStore((s) => s.language);

  function t(key: string, params?: Record<string, string>): string {
    const dict = domains[domain];
    if (!dict) return key;
    let text = dict[lang]?.[key] || dict["en"]?.[key] || key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(`{${k}}`, v);
      }
    }
    return text;
  }

  return { t, lang };
}

/** Non-reactive getter (for callbacks outside components) */
export function getT(lang: Lang) {
  return function t(domain: string, key: string, params?: Record<string, string>): string {
    const dict = domains[domain];
    if (!dict) return key;
    let text = dict[lang]?.[key] || dict["en"]?.[key] || key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(`{${k}}`, v);
      }
    }
    return text;
  };
}
