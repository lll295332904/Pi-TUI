import { useRef, useEffect, useCallback } from "react";
import { X } from "lucide-react";
import { usePiDeskStore } from "../store/pidesk";

export default function SearchBar() {
  const searchOpen = usePiDeskStore((s) => s.searchOpen);
  const setSearchOpen = usePiDeskStore((s) => s.setSearchOpen);
  const searchQuery = usePiDeskStore((s) => s.searchQuery);
  const setSearchQuery = usePiDeskStore((s) => s.setSearchQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [searchOpen]);

  const close = useCallback(() => setSearchOpen(false), [setSearchOpen]);

  if (!searchOpen) return null;

  return (
    <div className="absolute top-12 right-4 z-30 w-80 bg-white border border-border rounded-lg shadow-xl">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <input
          ref={inputRef}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") close(); }}
          placeholder="Search in conversation..."
          className="flex-1 text-sm outline-none bg-transparent"
        />
        <span className="text-xs text-muted">{searchQuery ? "matches" : "Ctrl+K"}</span>
        <button onClick={close} className="text-muted hover:text-gray-700">
          <X size={14} />
        </button>
      </div>
      {/* Search is passive — Conversation.tsx filters based on searchQuery */}
    </div>
  );
}
