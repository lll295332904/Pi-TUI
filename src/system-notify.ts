// ── System notifications (Windows toast / notification center) ──
//
// Task-completion alerts should reach the user even when the PiDesk window
// is minimized or in the background. This module sends a native OS
// notification and reports whether it was actually delivered so callers can
// fall back to the in-app toast when system notifications are unavailable
// (permission denied, unsupported platform, etc.).

import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

/**
 * Send a native OS notification.
 *
 * @returns true if the notification was sent, false if it could not be
 *          delivered (permission denied, plugin unavailable, ...).
 */
export async function notifySystem(title: string, body?: string): Promise<boolean> {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const permission = await requestPermission();
      granted = permission === "granted";
    }
    if (!granted) {
      console.warn("[notifySystem] notification permission denied");
      return false;
    }

    sendNotification({ title, body });
    return true;
  } catch (error) {
    // Plugin missing / non-Tauri environment / platform limitation.
    // Log the concrete reason so notification failures are diagnosable
    // from the DevTools console instead of silently falling back.
    console.warn("[notifySystem] system notification failed:", error);
    return false;
  }
}
