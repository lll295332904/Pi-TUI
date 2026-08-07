import { useState, useEffect, useCallback } from "react";
import { readPiFile, writePiFile, listPiFiles } from "../../bridge";
import { Save } from "lucide-react";

export default function ConfigFilesTab() {
  const [configFiles, setConfigFiles] = useState<string[]>([]);
  const [configContent, setConfigContent] = useState("");
  const [configFileName, setConfigFileName] = useState("");
  const [configDirty, setConfigDirty] = useState(false);

  useEffect(() => {
    listPiFiles().then(setConfigFiles).catch(console.error);
  }, []);

  const handleLoadConfig = useCallback(async (filename: string) => {
    try {
      const content = await readPiFile(filename);
      setConfigContent(content);
      setConfigFileName(filename);
      setConfigDirty(false);
    } catch (e) {
      setConfigContent(`Error: ${e}`);
    }
  }, []);

  const handleSaveConfig = useCallback(async () => {
    if (!configFileName) return;
    try {
      await writePiFile(configFileName, configContent);
      setConfigDirty(false);
    } catch (e) {
      console.error("Failed to save config:", e);
    }
  }, [configFileName, configContent]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <select
          value={configFileName}
          onChange={(e) => handleLoadConfig(e.target.value)}
          className="flex-1 text-sm border border-border rounded-md px-2 py-1 bg-white focus:outline-none focus:border-accent"
        >
          <option value="">— Select file —</option>
          {configFiles.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        {configFileName && (
          <button
            onClick={handleSaveConfig}
            disabled={!configDirty}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-accent text-white rounded-md hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save size={12} />
            Save
          </button>
        )}
      </div>
      {configFileName && (
        <>
          <div className="flex items-center gap-2 text-xs text-muted">
            <span>~/.pi/agent/{configFileName}</span>
            {configDirty && <span className="text-warning">● unsaved</span>}
          </div>
          <textarea
            value={configContent}
            onChange={(e) => { setConfigContent(e.target.value); setConfigDirty(true); }}
            className="w-full h-72 text-xs font-mono border border-border rounded-md p-2 bg-white focus:outline-none focus:border-accent resize-none"
            spellCheck={false}
          />
          <p className="text-xs text-muted">
            ⚠️ Editing these files may affect Pi&apos;s behavior. A backup (.bak) is created on save.
          </p>
        </>
      )}
    </div>
  );
}
