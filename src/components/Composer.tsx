import { useRef, useCallback, useState, KeyboardEvent } from "react";
import { usePiDeskStore } from "../store/pidesk";
import { Send, Square, Mic, MicOff } from "lucide-react";

const SpeechRecognitionAPI = (window as unknown as Record<string, unknown>).SpeechRecognition ||
  (window as unknown as Record<string, unknown>).webkitSpeechRecognition;

interface Props {
  onSend: (text: string) => void;
  onAbort: () => void;
}

export default function Composer({ onSend, onAbort }: Props) {
  const inputValue = usePiDeskStore((s) => s.inputValue);
  const setInputValue = usePiDeskStore((s) => s.setInputValue);
  const activeId = usePiDeskStore((s) => s.activeSessionId);
  const sessions = usePiDeskStore((s) => s.sessions);
  const isStreaming = activeId ? sessions[activeId]?.status === "streaming" : false;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<unknown>(null);
  const [isListening, setIsListening] = useState(false);

  const handleSend = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed || !activeId) return;
    onSend(trimmed);
  }, [inputValue, activeId, onSend]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming) handleSend();
    }
    if (e.key === "Escape" && isStreaming) {
      e.preventDefault();
      onAbort();
    }
  }, [handleSend, isStreaming, onAbort]);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 200) + "px";
    }
  }, []);

  // ── Voice input ──
  const toggleVoice = useCallback(() => {
    if (!SpeechRecognitionAPI) return;
    const SR = SpeechRecognitionAPI as new () => unknown;

    if (isListening) {
      (recognitionRef.current as { stop?: () => void } | null)?.stop?.();
      setIsListening(false);
      return;
    }

    const rec = new SR() as Record<string, unknown>;
    (rec as unknown as Record<string, unknown>).continuous = false;
    (rec as unknown as Record<string, unknown>).interimResults = true;
    (rec as unknown as Record<string, unknown>).lang = "zh-CN";

    (rec as unknown as Record<string, (e: unknown) => void>).onresult = (e: unknown) => {
      const event = e as { resultIndex: number; results: Array<Array<{ transcript: string }> & { isFinal?: boolean }> };
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      if (event.results[event.results.length - 1]?.isFinal) {
        const current = usePiDeskStore.getState().inputValue;
        setInputValue(current ? current + " " + transcript.trim() : transcript.trim());
      }
    };

    (rec as unknown as Record<string, () => void>).onerror = () => setIsListening(false);
    (rec as unknown as Record<string, () => void>).onend = () => setIsListening(false);

    recognitionRef.current = rec;
    (rec as unknown as { start: () => void }).start();
    setIsListening(true);
  }, [isListening, setInputValue]);

  return (
    <div className="border-t border-border bg-surface px-3 py-2 shrink-0">
      <div className="flex items-end gap-2 max-w-4xl mx-auto">
        {/* Voice button */}
        {!!SpeechRecognitionAPI && (
          <button
            onClick={toggleVoice}
            className={`shrink-0 p-2 rounded-md transition-colors ${
              isListening
                ? "bg-danger text-white"
                : "text-gray-400 hover:text-accent"
            }`}
            title={isListening ? "Stop recording" : "Voice input"}
          >
            {isListening ? <MicOff size={16} /> : <Mic size={16} />}
          </button>
        )}
        <textarea
          ref={textareaRef}
          value={inputValue}
          onChange={(e) => { setInputValue(e.target.value); adjustHeight(); }}
          onKeyDown={handleKeyDown}
          placeholder={isListening ? "Listening..." : isStreaming ? "Steer the agent... (Esc to abort)" : "Type a message... (Enter to send, Shift+Enter for newline)"}
          rows={1}
          className="flex-1 resize-none rounded-md border border-border px-3 py-1.5 text-sm
                     bg-white focus:outline-none focus:border-border-focus focus:ring-1 focus:ring-border-focus
                     placeholder:text-muted"
          disabled={!activeId}
        />
        <button
          onClick={isStreaming ? onAbort : handleSend}
          disabled={!activeId || (!isStreaming && !inputValue.trim())}
          className={`shrink-0 p-2 rounded-md transition-colors ${
            isStreaming
              ? "bg-danger text-white hover:bg-danger-hover"
              : "bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
          }`}
          title={isStreaming ? "Abort (Esc)" : "Send (Enter)"}
        >
          {isStreaming ? <Square size={16} /> : <Send size={16} />}
        </button>
      </div>
    </div>
  );
}
