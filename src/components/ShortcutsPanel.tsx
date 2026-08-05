import { X } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: "Ctrl + K", desc: "Search in conversation" },
  { keys: "Ctrl + N", desc: "New session" },
  { keys: "Ctrl + W", desc: "Delete current session" },
  { keys: "Ctrl + B", desc: "Toggle sidebar" },
  { keys: "Ctrl + I", desc: "Toggle inspector" },
  { keys: "Ctrl + ,", desc: "Open settings" },
  { keys: "Ctrl + / or ?", desc: "Show this panel" },
  { keys: "Escape", desc: "Close search / abort streaming" },
  { keys: "Enter", desc: "Send message" },
  { keys: "Shift + Enter", desc: "Newline in composer" },
];

export default function ShortcutsPanel({ open, onClose }: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-[420px] bg-white rounded-lg shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface-secondary">
          <span className="font-semibold text-sm text-gray-800">Keyboard Shortcuts</span>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X size={16} />
          </button>
        </div>
        <div className="p-4 space-y-1 max-h-[420px] overflow-y-auto">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-gray-50">
              <span className="text-sm text-gray-600">{s.desc}</span>
              <kbd className="px-2 py-0.5 text-xs font-mono bg-gray-100 border border-gray-300 rounded text-gray-700">
                {s.keys}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
