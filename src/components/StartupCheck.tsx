import { useState, useEffect } from "react";
import { runStartupDiagnostics } from "../bridge";
import type { StartupDiagnostics } from "../bridge";
import { AlertTriangle, CheckCircle, Copy, RefreshCw, XCircle } from "lucide-react";

interface Props {
  onRetry: () => void;
  onContinueAnyway: () => void;
}

function StatusIcon({ ok }: { ok: boolean }) {
  return ok
    ? <CheckCircle size={14} className="text-green-400" />
    : <XCircle size={14} className="text-red-400" />;
}

function BundleCheckRow({ label, item }: { label: string; item: { ok: boolean; detail: string } }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <StatusIcon ok={item.ok} />
      <span className={item.ok ? "text-green-300" : "text-red-300"}>{label}</span>
      {!item.ok && <span className="text-zinc-500 truncate max-w-[200px]">({item.detail})</span>}
    </div>
  );
}

export default function StartupDiagnosticsPanel({ onRetry, onContinueAnyway }: Props) {
  const [diag, setDiag] = useState<StartupDiagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    runDiagnostics();
  }, []);

  async function runDiagnostics() {
    setLoading(true);
    try {
      const result = await runStartupDiagnostics();
      setDiag(result);
      if (result.ok) {
        onContinueAnyway();
      }
    } catch (e) {
      setDiag(null);
    } finally {
      setLoading(false);
    }
  }

  function copyDiagnostics() {
    if (!diag) return;
    const text = [
      `PiDesk Startup Diagnostics`,
      `App Version: ${diag.versions.app_version}`,
      `Bundled Pi: ${diag.versions.bundled_pi_version || "N/A"}`,
      ``,
      `Pi Bundle:`,
      `  node.exe: ${diag.pi_bundle.node.ok ? "OK" : "MISSING"} - ${diag.pi_bundle.node.detail}`,
      `  package.json: ${diag.pi_bundle.package_json.ok ? "OK" : "MISSING"}`,
      `  rpc-entry.js: ${diag.pi_bundle.rpc_entry.ok ? "OK" : "MISSING"}`,
      `  index.js: ${diag.pi_bundle.index_entry.ok ? "OK" : "MISSING"}`,
      `  node_modules: ${diag.pi_bundle.node_modules.ok ? "OK" : "MISSING"}`,
      ``,
      `User Data:`,
      `  Dir: ${diag.user_data.pi_agent_dir}`,
      `  Readable: ${diag.user_data.readable}`,
      `  Writable: ${diag.user_data.writable}`,
      ``,
      `Errors:`,
      ...diag.errors.map(e => `  [${e.component}] ${e.message}`),
    ].join("\n");

    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent" />
        <p className="text-zinc-400 text-sm">Running startup diagnostics...</p>
      </div>
    );
  }

  if (!diag) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <AlertTriangle size={48} className="text-yellow-500" />
        <h2 className="text-lg font-bold text-white">Diagnostics Unavailable</h2>
        <p className="text-zinc-400 text-sm text-center max-w-md">
          Unable to run startup diagnostics. The application may be damaged. Please reinstall.
        </p>
        <button onClick={runDiagnostics} className="px-4 py-2 bg-blue-600 rounded text-sm text-white hover:bg-blue-700">
          Retry
        </button>
      </div>
    );
  }

  if (diag.ok) return null;

  return (
    <div className="flex flex-col h-full bg-zinc-900">
      <div className="flex-1 overflow-auto p-6">
        <div className="flex items-center gap-3 mb-6">
          <AlertTriangle size={32} className="text-yellow-500" />
          <div>
            <h2 className="text-lg font-bold text-white">Installation Issue Detected</h2>
            <p className="text-zinc-400 text-sm">
              PiDesk cannot start because the installation is incomplete or damaged.
            </p>
          </div>
        </div>

        {/* Pi Bundle Checks */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-zinc-300 mb-2">Pi Runtime Bundle</h3>
          <div className="bg-zinc-800 rounded-lg p-3 space-y-1.5">
            <BundleCheckRow label="node.exe" item={diag.pi_bundle.node} />
            <BundleCheckRow label="package.json" item={diag.pi_bundle.package_json} />
            <BundleCheckRow label="dist/rpc-entry.js" item={diag.pi_bundle.rpc_entry} />
            <BundleCheckRow label="dist/index.js" item={diag.pi_bundle.index_entry} />
            <BundleCheckRow label="node_modules" item={diag.pi_bundle.node_modules} />
          </div>
        </div>

        {/* User Data Checks */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-zinc-300 mb-2">User Data</h3>
          <div className="bg-zinc-800 rounded-lg p-3 text-xs text-zinc-400 space-y-1">
            <div className="flex items-center gap-2">
              <span>Directory:</span>
              <code className="text-zinc-500">{diag.user_data.pi_agent_dir}</code>
            </div>
            <div className="flex items-center gap-2">
              <StatusIcon ok={diag.user_data.readable} />
              <span>Readable</span>
            </div>
            <div className="flex items-center gap-2">
              <StatusIcon ok={diag.user_data.writable} />
              <span>Writable</span>
            </div>
          </div>
        </div>

        {/* Version Info */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-zinc-300 mb-2">Versions</h3>
          <div className="bg-zinc-800 rounded-lg p-3 text-xs text-zinc-400 space-y-1">
            <div>App: {diag.versions.app_version}</div>
            <div>Bundled Pi: {diag.versions.bundled_pi_version || "N/A"}</div>
          </div>
        </div>

        {/* Errors */}
        {diag.errors.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-red-400 mb-2">Errors Found</h3>
            <div className="bg-red-900/20 border border-red-800 rounded-lg p-3 space-y-1">
              {diag.errors.map((e, i) => (
                <div key={i} className="text-xs text-red-300">
                  <span className="text-red-400">[{e.component}]</span> {e.message}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between p-4 border-t border-zinc-800 bg-zinc-900/50">
        <button
          onClick={copyDiagnostics}
          className="flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-400 hover:text-white bg-zinc-800 rounded hover:bg-zinc-700"
        >
          <Copy size={12} />
          {copied ? "Copied!" : "Copy Diagnostics"}
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={onContinueAnyway}
            className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white bg-zinc-800 rounded hover:bg-zinc-700"
          >
            Continue Anyway
          </button>
          <button
            onClick={onRetry}
            className="flex items-center gap-2 px-4 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700"
          >
            <RefreshCw size={12} />
            Retry Diagnostics
          </button>
        </div>
      </div>
    </div>
  );
}
