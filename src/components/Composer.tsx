import { useRef, useCallback, useState, KeyboardEvent, ClipboardEvent } from "react";
import { usePiDeskStore } from "../store/pidesk";
import { Send, Square, Mic, MicOff, Paperclip, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { readImage as readClipboardImage } from "@tauri-apps/plugin-clipboard-manager";

const SpeechRecognitionAPI = (window as unknown as Record<string, unknown>).SpeechRecognition ||
  (window as unknown as Record<string, unknown>).webkitSpeechRecognition;

interface Props {
  onSend: (text: string, images?: string[]) => void;
  onAbort: () => void;
}

export default function Composer({ onSend, onAbort }: Props) {
  const inputValue = usePiDeskStore((s) => s.inputValue);
  const setInputValue = usePiDeskStore((s) => s.setInputValue);
  const activeId = usePiDeskStore((s) => s.activeSessionId);
  const inputImages = usePiDeskStore((s) => s.inputImages);
  const addInputImage = usePiDeskStore((s) => s.addInputImage);
  const removeInputImage = usePiDeskStore((s) => s.removeInputImage);
  const sessions = usePiDeskStore((s) => s.sessions);
  const settings = usePiDeskStore((s) => s.settings);
  const pendingQueues = usePiDeskStore((s) => s.pendingQueues);
  const isStreaming = activeId ? sessions[activeId]?.status === "streaming" : false;
  const runningStatus = activeId ? sessions[activeId]?.status : "idle";
  const pendingCount = activeId ? (pendingQueues[activeId] || []).length : 0;
  const queueHint = settings.queueWhileRunning && (runningStatus === "streaming" || runningStatus === "compacting" || runningStatus === "retrying");

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<unknown>(null);
  const [isListening, setIsListening] = useState(false);

  const handleSend = useCallback(() => {
    const trimmed = inputValue.trim();
    if ((!trimmed && inputImages.length === 0) || !activeId) return;
    onSend(trimmed, inputImages);
  }, [inputValue, inputImages, activeId, onSend]);

  const handleAttachImages = useCallback(async () => {
    const selected = await open({
      multiple: true,
      directory: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    for (const path of paths) {
      if (!inputImages.includes(path)) addInputImage(path);
    }
  }, [inputImages, addInputImage]);

  // ── Paste image from clipboard ──
  const addPastedImage = useCallback(async (bytes: Uint8Array, mimeType: string) => {
    // Map MIME type to a safe file extension
    const extMap: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/gif": "gif",
      "image/webp": "webp",
      "image/bmp": "bmp",
    };
    const ext = extMap[mimeType] ?? "png";
    // Base64-encode without data: prefix (Chunked to avoid call-stack limits on large images)
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    const dataBase64 = btoa(binary);
    try {
      const path = await invoke<string>("save_pasted_image", { dataBase64, ext });
      if (inputImages.includes(path)) return;
      addInputImage(path);
      usePiDeskStore.getState().addToast({
        type: "success",
        title: "Image pasted",
        message: "The pasted image has been attached. Press Enter to send.",
        durationMs: 3000,
      });
    } catch (err) {
      console.error("Failed to save pasted image:", err);
      usePiDeskStore.getState().addToast({
        type: "error",
        title: "Paste failed",
        message: String(err),
        durationMs: 5000,
      });
    }
  }, [inputImages, addInputImage]);

  const handlePaste = useCallback(async (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    let file: File | null = null;
    let mimeType = "";
    if (items) {
      for (const item of Array.from(items)) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          file = item.getAsFile();
          mimeType = item.type;
          if (file) break;
        }
      }
    }
    if (!file) {
      // Fallback: read straight from the OS clipboard via the Tauri plugin (RGBA)
      try {
        const img = await readClipboardImage();
        const rgba = new Uint8Array(await img.rgba());
        const { width, height } = await img.size();
        e.preventDefault();
        try {
          const path = await invoke<string>("save_pasted_rgba", {
            rgba: Array.from(rgba),
            width,
            height,
          });
          if (!inputImages.includes(path)) addInputImage(path);
        } catch (err) {
          console.error("Failed to save pasted RGBA image:", err);
          usePiDeskStore.getState().addToast({
            type: "error",
            title: "Paste failed",
            message: String(err),
            durationMs: 5000,
          });
        }
      } catch {
        return; // no image on the clipboard — let the default text paste proceed
      }
      return;
    }
    e.preventDefault();
    const buf = new Uint8Array(await file.arrayBuffer());
    addPastedImage(buf, mimeType);
  }, [addPastedImage, inputImages, addInputImage]);

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
      {pendingCount > 0 && (
        <div className="flex items-center justify-between max-w-4xl mx-auto mb-2 px-3 py-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md">
          <span>{pendingCount} message{pendingCount > 1 ? "s" : ""} queued - will send after the current task finishes</span>
          <button
            onClick={() => activeId && usePiDeskStore.getState().clearPendingQueue(activeId)}
            className="ml-3 text-amber-600 hover:text-amber-800 underline shrink-0"
          >
            Clear
          </button>
        </div>
      )}
      {inputImages.length > 0 && (
        <div className="flex flex-wrap gap-1.5 max-w-4xl mx-auto mb-2">
          {inputImages.map((path) => (
            <div key={path} className="flex items-center gap-1 max-w-56 px-2 py-1 rounded border border-border bg-gray-50 text-xs text-gray-600">
              <span className="truncate" title={path}>{path.split(/[\\/]/).pop()}</span>
              <button onClick={() => removeInputImage(path)} className="shrink-0 text-gray-400 hover:text-danger" title="Remove image" aria-label="Remove image">
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
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
          onPaste={handlePaste}
          placeholder={isListening ? "Listening..." : queueHint ? "Task running - messages will be queued and auto-sent when it finishes... (Esc to abort)" : isStreaming ? "Steer the agent... (Esc to abort)" : "Type a message... (Enter to send, Shift+Enter for newline)"}
          rows={1}
          className="flex-1 resize-none rounded-md border border-border px-3 py-1.5 text-sm
                     bg-white focus:outline-none focus:border-border-focus focus:ring-1 focus:ring-border-focus
                     placeholder:text-muted"
          disabled={!activeId}
        />
        <button
          onClick={handleAttachImages}
          disabled={!activeId || isStreaming}
          className="shrink-0 p-2 rounded-md text-gray-400 hover:text-accent disabled:opacity-50 disabled:cursor-not-allowed"
          title="Attach image"
          aria-label="Attach image"
        >
          <Paperclip size={16} />
        </button>
        <button
          onClick={isStreaming ? onAbort : handleSend}
          disabled={!activeId || (!isStreaming && !inputValue.trim() && inputImages.length === 0)}
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
