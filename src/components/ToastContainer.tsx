import { useEffect } from "react";
import { usePiDeskStore } from "../store/pidesk";
import type { ToastItem } from "../types";
import { CheckCircle, AlertTriangle, Info, AlertCircle, X } from "lucide-react";

const ICON_MAP = {
  success: CheckCircle,
  warning: AlertTriangle,
  info: Info,
  error: AlertCircle,
} as const;

const COLOR_MAP = {
  success: "border-green-400 bg-green-50 text-green-800",
  warning: "border-yellow-400 bg-yellow-50 text-yellow-800",
  info: "border-blue-400 bg-blue-50 text-blue-800",
  error: "border-red-400 bg-red-50 text-red-800",
} as const;

export default function ToastContainer() {
  const toasts = usePiDeskStore((s) => s.toasts);
  const removeToast = usePiDeskStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={() => removeToast(toast.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const Icon = ICON_MAP[toast.type];
  const color = COLOR_MAP[toast.type];

  useEffect(() => {
    if (!toast.durationMs) return;
    const timer = setTimeout(onDismiss, toast.durationMs);
    return () => clearTimeout(timer);
  }, [toast.id, toast.durationMs, onDismiss]);

  return (
    <div className={`flex items-start gap-2 border rounded-lg shadow-lg p-3 animate-slide-in ${color}`}>
      <Icon size={16} className="shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium">{toast.title}</div>
        {toast.message && <div className="text-xs opacity-80 mt-0.5">{toast.message}</div>}
      </div>
      <button onClick={onDismiss} className="shrink-0 opacity-60 hover:opacity-100">
        <X size={14} />
      </button>
    </div>
  );
}
