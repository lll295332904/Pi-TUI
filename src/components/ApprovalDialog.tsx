import { usePiDeskStore } from "../store/pidesk";
import { respondExtensionUi } from "../bridge";
import type { ExtensionUiRequest } from "../types";
import { ShieldAlert } from "lucide-react";

export default function ApprovalDialog() {
  const requests = usePiDeskStore((s) => s.extensionUiRequests);
  const removeRequest = usePiDeskStore((s) => s.removeExtensionUiRequest);
  const activeId = usePiDeskStore((s) => s.activeSessionId);

  if (requests.length === 0) return null;

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 space-y-2 max-w-md w-full px-4">
      {requests.map((req) => (
        <ApprovalCard
          key={req.id}
          request={req}
          onRespond={async (response) => {
            if (activeId) {
              try {
                await respondExtensionUi(activeId, req.id, response);
              } catch (e) {
                console.error("Failed to respond:", e);
              }
            }
            removeRequest(req.id);
          }}
        />
      ))}
    </div>
  );
}

function ApprovalCard({
  request,
  onRespond,
}: {
  request: ExtensionUiRequest;
  onRespond: (response: Record<string, unknown>) => void;
}) {
  const method = request.method;

  // Only handle "confirm" for now
  if (method !== "confirm") {
    setTimeout(() => onRespond({ cancelled: true }), 100);
    return null;
  }

  const title = request.title || "Confirmation Required";
  const message = request.message || "";

  return (
    <div className="bg-white border border-border rounded-lg shadow-xl p-4 text-sm animate-fade-slide">
      <div className="flex items-center gap-2 mb-2">
        <ShieldAlert size={16} className="text-warning" />
        <span className="font-semibold text-gray-800">{title}</span>
      </div>
      {message && (
        <pre className="text-xs text-gray-600 bg-gray-50 rounded p-2 mb-3 whitespace-pre-wrap break-words max-h-32 overflow-y-auto font-mono">
          {message}
        </pre>
      )}
      <div className="flex gap-2 justify-end">
        <button
          onClick={() => onRespond({ confirmed: false })}
          className="px-3 py-1.5 text-xs rounded-md border border-border text-gray-600 hover:bg-gray-50"
        >
          Deny
        </button>
        <button
          onClick={() => onRespond({ confirmed: true })}
          className="px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover"
        >
          Allow
        </button>
      </div>
    </div>
  );
}
