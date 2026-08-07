import { useState, useEffect, useCallback } from "react";
import { readPiFile } from "../../bridge";
import { X } from "lucide-react";

export default function McpTab() {
  const [mcpServers, setMcpServers] = useState<Array<{ name: string; command: string; args: string }>>([]);

  const loadMcpServers = useCallback(async () => {
    try {
      const raw = await readPiFile("settings.json");
      const settings = JSON.parse(raw);
      const servers = settings.mcpServers || {};
      const list = Object.entries(servers).map(([name, cfg]: [string, any]) => ({
        name,
        command: cfg.command || "",
        args: (cfg.args || []).join(", "),
      }));
      setMcpServers(list);
    } catch {
      setMcpServers([]);
    }
  }, []);

  useEffect(() => { loadMcpServers(); }, [loadMcpServers]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Manage MCP (Model Context Protocol) servers that Pi can connect to for tools and resources.
        Configuration is stored in <code className="text-[11px] bg-gray-100 px-1 rounded">settings.json</code>.
      </p>

      <div className="space-y-2">
        <div className="text-xs font-medium text-gray-600">Configured Servers</div>
        <div className="space-y-1">
          {mcpServers.length === 0 ? (
            <div className="text-xs text-muted italic py-2">No MCP servers configured. Add one below or edit settings.json directly.</div>
          ) : (
            mcpServers.map((srv) => (
              <div key={srv.name} className="flex items-center gap-2 bg-gray-50 rounded px-2 py-1.5 text-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                <span className="font-mono text-gray-700 flex-1">{srv.name}</span>
                <span className="text-muted truncate max-w-[120px]">{srv.command}{srv.args ? ` ${srv.args}` : ""}</span>
                <button className="text-red-400 hover:text-red-600">
                  <X size={12} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="border-t border-border pt-3">
        <div className="text-xs font-medium text-gray-600 mb-2">Add MCP Server</div>
        <div className="grid grid-cols-2 gap-2">
          <input placeholder="Server name" className="text-sm border border-border rounded-md px-2 py-1 bg-white focus:outline-none focus:border-accent" />
          <input placeholder="Command (e.g. npx)" className="text-sm border border-border rounded-md px-2 py-1 bg-white focus:outline-none focus:border-accent" />
          <div className="col-span-2">
            <input placeholder="Args (comma-separated)" className="w-full text-sm border border-border rounded-md px-2 py-1 bg-white focus:outline-none focus:border-accent" />
          </div>
        </div>
        <button className="mt-2 px-3 py-1 text-xs bg-accent text-white rounded-md hover:bg-accent-hover">
          Add Server
        </button>
      </div>
    </div>
  );
}
