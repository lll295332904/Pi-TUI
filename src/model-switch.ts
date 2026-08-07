/**
 * Unified model-switch path.
 *
 * Every place that changes the active session model (TopBar selector,
 * Settings → Model, role-based switching, session init) must go through
 * this function so the UX is consistent:
 *   - "switching…" indicator while pi confirms the switch
 *   - correlated rpc-response handling (bridge setModel)
 *   - session model updated in the store only after pi confirms
 *   - error toast on failure
 */
import { setModel } from "./bridge";
import { usePiDeskStore } from "./store/pidesk";
import { getT } from "./i18n";

export interface SwitchModelOptions {
  /** Suppress the error toast (used during silent session init). */
  silent?: boolean;
}

/**
 * Switch the active model for a session. Resolves with true on success.
 * Always clears the "switching…" indicator, even on failure.
 */
export async function switchModel(
  sid: string,
  provider: string,
  modelId: string,
  opts: SwitchModelOptions = {},
): Promise<boolean> {
  const s = usePiDeskStore.getState();
  s.setModelSwitching(sid, { provider, id: modelId });
  try {
    await setModel(sid, provider, modelId);
    s.updateSessionModel(sid, provider, modelId);
    return true;
  } catch (e) {
    console.error("setModel failed:", e);
    if (!opts.silent) {
      const t = getT(s.language);
      const detail = e instanceof Error ? e.message : String(e);
      s.addToast({
        type: "error",
        title: t("toast", "error"),
        message: `${t("toast", "modelSwitchFailed")} ${detail}`,
        durationMs: 8000,
      });
    }
    return false;
  } finally {
    s.setModelSwitching(sid, null);
  }
}
