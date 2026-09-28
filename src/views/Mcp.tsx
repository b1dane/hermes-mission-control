import { useState, type ReactNode } from "react";
import type { McpCatalogEntry, McpResult, McpServer, HermesApi } from "../api";
import { useLive } from "../hooks";
import { Badge, Led, Panel, Toggle } from "../components/ui";
import { cn } from "../utils/cn";

type View = "servers" | "catalog" | "add";
type HeaderRow = { name: string; prefix: string; value: string };
type EnvRow = { name: string; value: string };

const EMPTY_FORM = {
  name: "",
  kind: "http" as "http" | "stdio",
  url: "",
  command: "npx",
  args: "",
  auth: "none" as "none" | "oauth" | "header",
  trust: "untrusted",
  transport: "streamable",
  lazy: false,
  parallel: false,
  timeout: "",
  connectTimeout: "",
  advanced: "",
};

export default function Mcp({ api, online }: { api: HermesApi; online: boolean }) {
  const [view, setView] = useState<View>("servers");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<McpResult | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [headers, setHeaders] = useState<HeaderRow[]>([{ name: "Authorization", prefix: "Bearer", value: "" }]);
  const [envRows, setEnvRows] = useState<EnvRow[]>([{ name: "", value: "" }]);
  const [catalogSecrets, setCatalogSecrets] = useState<EnvRow[]>([{ name: "", value: "" }]);
  const [toolPanel, setToolPanel] = useState<string | null>(null);
  const [toolRows, setToolRows] = useState<Array<{ name: string; description: string }>>([]);
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [toolFlags, setToolFlags] = useState({ resources: true, prompts: true });
  const serversQuery = useLive(online, () => api.mcp(), 12000);
  const catalogQuery = useLive(online && view === "catalog", () => api.mcpCatalog(), 0, [view]);
  const servers = serversQuery.data?.servers ?? [];
  const catalog = catalogQuery.data?.entries ?? [];

  const showResult = (result: McpResult) => {
    setNotice(result);
    if (result.ok) {
      serversQuery.refresh();
      catalogQuery.refresh();
    }
  };

  const action = async (name: string, actionName: "test" | "enable" | "disable" | "remove" | "login" | "catalog-install") => {
    setBusy(name + actionName);
    setNotice(null);
    try {
      const result = await api.mcpAction(actionName, name);
      if (actionName === "test") {
        const rows = result.tools ?? [];
        setToolRows(rows);
        const server = servers.find((s) => s.name === name);
        const filter = server?.tool_filter;
        setSelectedTools(filter?.include ? [...filter.include] : rows.filter((r) => !filter?.exclude?.includes(r.name)).map((r) => r.name));
        setToolFlags({ resources: filter?.resources ?? true, prompts: filter?.prompts ?? true });
        setToolPanel(name);
      }
      showResult(result);
    } catch (e) {
      showResult({ ok: false, code: 1, stdout: "", stderr: String(e) });
    } finally {
      setBusy(null);
    }
  };

  const saveTools = async (name: string) => {
    setBusy(name + "filters");
    try {
      const include = selectedTools.length === toolRows.length ? null : selectedTools;
      const result = await api.filterMcp(name, { include, resources: toolFlags.resources, prompts: toolFlags.prompts });
      showResult(result);
    } catch (e) {
      showResult({ ok: false, code: 1, stdout: "", stderr: String(e) });
    } finally {
      setBusy(null);
    }
  };

  const saveServer = async () => {
    if (!form.name.trim()) return;
    const replacing = servers.some((server) => server.name === form.name.trim());
    if (replacing && !confirm(`Replace the existing MCP server "${form.name.trim()}"?`)) return;
    const env = envRows.filter((r) => r.name.trim() && r.value).map((r) => ({ name: r.name.trim(), value: r.value }));
    const headerRows = headers.filter((r) => r.name.trim() && r.value).map((r) => ({
      name: r.name.trim(),
      prefix: r.prefix.trim(),
      value: r.value,
    }));
    let advanced: Record<string, unknown> | undefined;
    if (form.advanced.trim()) {
      try {
        advanced = JSON.parse(form.advanced) as Record<string, unknown>;
      } catch (e) {
        showResult({ ok: false, code: 2, stdout: "", stderr: `Advanced config JSON is invalid: ${String(e)}` });
        return;
      }
    }

    const options: Record<string, unknown> = {
      trust: form.trust,
      lazy: form.lazy,
      supports_parallel_tool_calls: form.parallel,
    };
    if (form.kind === "http") options.transport = form.transport === "sse" ? "sse" : undefined;
    if (form.timeout) options.timeout = Number(form.timeout);
    if (form.connectTimeout) options.connect_timeout = Number(form.connectTimeout);

    setBusy("save");
    setNotice(null);
    try {
      const result = await api.saveMcp({
        name: form.name.trim(),
        kind: form.kind,
        url: form.url.trim(),
        command: form.command.trim(),
        args: form.args,
        auth: form.auth,
        headers: form.kind === "http" && form.auth === "header" ? headerRows : [],
        env,
        options,
        advanced,
        replace: replacing,
      });
      showResult(result);
      if (result.ok) {
        setForm(EMPTY_FORM);
        setHeaders([{ name: "Authorization", prefix: "Bearer", value: "" }]);
        setEnvRows([{ name: "", value: "" }]);
        setView("servers");
      }
    } catch (e) {
      showResult({ ok: false, code: 1, stdout: "", stderr: String(e) });
    } finally {
      setBusy(null);
    }
  };

  const installCatalog = async (entry: McpCatalogEntry) => {
    const secrets = Object.fromEntries(catalogSecrets.filter((row) => row.name.trim() && row.value).map((row) => [row.name.trim(), row.value]));
    setBusy(entry.name + "install");
    try {
      const result = await api.installCatalog(entry.name, secrets);
      setCatalogSecrets([{ name: "", value: "" }]);
      showResult(result);
    } catch (e) {
      showResult({ ok: false, code: 1, stdout: "", stderr: String(e) });
    } finally {
      setBusy(null);
    }
  };

  const filteredServers = servers.filter((s) => `${s.name} ${s.url ?? ""} ${s.command ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const filteredCatalog = catalog.filter((e) => `${e.name} ${e.description}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1 pt-1">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.24em] text-gold/80">Tool connections</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink sm:text-2xl">Model Context Protocol</h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-mute">
            Connect trusted tools to Hermes, inspect discovered capabilities, and manage the same servers in your active Hermes profile.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] tabular-nums text-mute">{servers.length} configured</span>
          <button onClick={serversQuery.refresh} className="rounded-full border border-edge px-3 py-1.5 text-[10px] text-mute transition hover:border-gold/30 hover:text-ink">Refresh</button>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-edge px-1">
        {(["servers", "catalog", "add"] as const).map((v) => (
          <button
            key={v}
            onClick={() => { setView(v); setSearch(""); setNotice(null); }}
            className={cn("border-b-2 px-3 py-2 text-[11px] font-medium capitalize transition-colors", view === v ? "border-gold text-ink" : "border-transparent text-mute hover:text-ink")}
          >
            {v === "servers" ? "Connections" : v === "catalog" ? "Nous catalog" : "Add server"}
          </button>
        ))}
      </div>

      {view !== "add" && (
        <div className="flex items-center gap-2 px-1">
          <span className="text-mute">⌕</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={view === "servers" ? "Find a connection" : "Search approved MCPs"}
            className="w-full bg-transparent py-1 text-xs text-ink placeholder-mute/70 outline-none"
          />
          {view === "catalog" && catalogQuery.loading && <span className="text-[10px] text-mute">Loading</span>}
        </div>
      )}

      {!online && (
        <div className="rounded-lg border border-gold/20 bg-gold/[0.04] px-4 py-3 text-xs text-gold/90">
          Start the Python bridge in Termux to manage your real MCP servers. Demo mode cannot make changes.
        </div>
      )}

      {view === "servers" && (
        <div className="overflow-hidden rounded-xl border border-edge bg-panel/70">
          {filteredServers.length ? filteredServers.map((server) => (
            <ServerRow
              key={server.name}
              server={server}
              online={online}
              busy={busy}
              toolsOpen={toolPanel === server.name}
              toolRows={toolPanel === server.name ? toolRows : []}
              selectedTools={selectedTools}
              toolFlags={toolFlags}
              onAction={action}
              onToggleFilters={() => setToolPanel(toolPanel === server.name ? null : server.name)}
              onSelectTool={(name) => setSelectedTools((p) => p.includes(name) ? p.filter((x) => x !== name) : [...p, name])}
              onToolFlag={(key, value) => setToolFlags((p) => ({ ...p, [key]: value }))}
              onSaveTools={saveTools}
            />
          )) : (
            <div className="px-5 py-12 text-center">
              <div className="text-sm text-ink">{online ? "No MCP servers configured" : "Bridge offline"}</div>
              <p className="mt-1 text-xs text-mute">Add a local stdio server or a remote HTTP endpoint to extend Hermes.</p>
              {online && <button onClick={() => setView("add")} className="mt-3 text-xs text-gold hover:underline">Add your first server</button>}
            </div>
          )}
        </div>
      )}

      {view === "catalog" && (
        <div className="space-y-3">
          <p className="px-1 text-[11px] leading-relaxed text-mute">
            Nous-maintained catalog entries are loaded from your installed Hermes Agent. Install uses the official <span className="text-ink">hermes mcp install</span> flow.
          </p>
          {filteredCatalog.length ? (
            <div className="overflow-hidden rounded-xl border border-edge bg-panel/70">
              {filteredCatalog.map((entry) => {
                const installed = servers.find((s) => s.name === entry.name);
                return (
                  <div key={entry.name} className="flex flex-wrap items-center gap-3 border-b border-edge/70 px-4 py-3 last:border-0">
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-edge2 text-xs text-gold">M</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-ink">{entry.name}</span>
                        <Badge tone={installed?.enabled ? "mint" : installed ? "warn" : "mute"}>{installed ? (installed.enabled ? "connected" : "disabled") : entry.status}</Badge>
                      </div>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-mute">{entry.description || "Nous-approved MCP server"}</p>
                    </div>
                    <button
                      disabled={!online || !!busy || !!installed}
                      onClick={() => installCatalog(entry)}
                      className="rounded-full border border-edge2 px-3 py-1.5 text-[10px] font-medium text-ink transition hover:border-gold/40 hover:text-gold disabled:opacity-40"
                    >
                      {busy === entry.name + "install" ? "Installing..." : installed ? "Installed" : "Install"}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-edge bg-panel/60 px-5 py-10 text-center text-xs text-mute">
              {catalogQuery.error ? `Could not read catalog: ${catalogQuery.error}` : online ? "No catalog entries matched. Check the Hermes install or try a broader search." : "Connect the bridge to browse Hermes' approved catalog."}
            </div>
          )}
          <details className="rounded-lg border border-edge bg-panel/40 px-4 py-3">
            <summary className="cursor-pointer text-[11px] text-mute">Catalog credentials · optional</summary>
            <p className="mt-2 text-[10px] leading-relaxed text-mute">If an entry needs API keys, add its environment variable name and value. The bridge saves credentials in the private <span className="text-gold">~/.hermes/.env</span>; secret inputs stay masked and values are never returned.</p>
            <div className="mt-2 space-y-2">
              {catalogSecrets.map((row, index) => (
                <div key={index} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
                  <input value={row.name} onChange={(e) => setCatalogSecrets((p) => p.map((r, i) => i === index ? { ...r, name: e.target.value } : r))} placeholder="MCP_SERVICE_API_KEY" className="rounded-md border border-edge bg-void/60 px-2.5 py-2 font-mono text-[10px] text-ink placeholder-mute/60 outline-none" />
                  <input type="password" value={row.value} onChange={(e) => setCatalogSecrets((p) => p.map((r, i) => i === index ? { ...r, value: e.target.value } : r))} placeholder="Secret value" className="rounded-md border border-edge bg-void/60 px-2.5 py-2 text-[11px] text-ink placeholder-mute/60 outline-none" />
                  <button onClick={() => setCatalogSecrets((p) => p.filter((_, i) => i !== index))} className="px-2 text-[10px] text-mute hover:text-alert">Remove</button>
                </div>
              ))}
              <button onClick={() => setCatalogSecrets((p) => [...p, { name: "", value: "" }])} className="text-[10px] text-gold">+ add variable</button>
            </div>
          </details>
        </div>
      )}

      {view === "add" && (
        <Panel title="New MCP connection" right={<Badge tone="teal">Hermes config</Badge>}>
          <div className="mx-auto max-w-3xl space-y-5">
            <div>
              <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-[0.16em] text-mute">Connection type</label>
              <div className="inline-flex rounded-full border border-edge bg-void/60 p-1">
                {(["http", "stdio"] as const).map((kind) => (
                  <button key={kind} onClick={() => setForm((p) => ({ ...p, kind }))} className={cn("rounded-full px-4 py-1.5 text-[10px] font-medium uppercase tracking-wide transition", form.kind === kind ? "bg-gold/15 text-gold" : "text-mute hover:text-ink")}>
                    {kind === "http" ? "Remote HTTP" : "Local stdio"}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Server name" value={form.name} placeholder="e.g. linear" onChange={(v) => setForm((p) => ({ ...p, name: v }))} />
              {form.kind === "http" ? (
                <Field label="MCP endpoint URL" value={form.url} placeholder="https://mcp.example.com/mcp" onChange={(v) => setForm((p) => ({ ...p, url: v }))} />
              ) : (
                <Field label="Command" value={form.command} placeholder="npx, uvx, python" onChange={(v) => setForm((p) => ({ ...p, command: v }))} />
              )}
            </div>

            {form.kind === "http" ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-[0.16em] text-mute">Authentication</span>
                    <select value={form.auth} onChange={(e) => setForm((p) => ({ ...p, auth: e.target.value as typeof p.auth }))} className="w-full rounded-lg border border-edge bg-void/60 px-3 py-2.5 text-xs text-ink outline-none focus:border-gold/30">
                      <option value="none">No auth</option><option value="oauth">OAuth 2.1</option><option value="header">HTTP headers</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-[0.16em] text-mute">HTTP transport</span>
                    <select value={form.transport} onChange={(e) => setForm((p) => ({ ...p, transport: e.target.value }))} className="w-full rounded-lg border border-edge bg-void/60 px-3 py-2.5 text-xs text-ink outline-none focus:border-gold/30">
                      <option value="streamable">Streamable HTTP</option><option value="sse">Legacy HTTP + SSE</option>
                    </select>
                  </label>
                </div>
                {form.auth === "header" && (
                  <div className="space-y-2 rounded-lg border border-edge bg-void/30 p-3">
                    <div className="flex items-center justify-between"><span className="text-[10px] font-medium uppercase tracking-[0.16em] text-mute">Secure request headers</span><button onClick={() => setHeaders((p) => [...p, { name: "", prefix: "", value: "" }])} className="text-[10px] text-gold">+ add header</button></div>
                    {headers.map((row, i) => (
                      <div key={i} className="grid gap-2 sm:grid-cols-[1fr_0.8fr_1.5fr_auto]">
                        <input value={row.name} onChange={(e) => setHeaders((p) => p.map((r, n) => n === i ? { ...r, name: e.target.value } : r))} placeholder="Header name" className="rounded-md border border-edge bg-void/70 px-2.5 py-2 text-[11px] text-ink outline-none" />
                        <input value={row.prefix} onChange={(e) => setHeaders((p) => p.map((r, n) => n === i ? { ...r, prefix: e.target.value } : r))} placeholder="Prefix (Bearer)" className="rounded-md border border-edge bg-void/70 px-2.5 py-2 text-[11px] text-ink outline-none" />
                        <input type="password" value={row.value} onChange={(e) => setHeaders((p) => p.map((r, n) => n === i ? { ...r, value: e.target.value } : r))} placeholder="Secret value" className="rounded-md border border-edge bg-void/70 px-2.5 py-2 text-[11px] text-ink outline-none" />
                        <button onClick={() => setHeaders((p) => p.filter((_, n) => n !== i))} className="px-2 text-mute hover:text-alert">Remove</button>
                      </div>
                    ))}
                    <p className="text-[10px] text-mute">Secrets are stored in Hermes' private .env file; config.yaml receives only references.</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <Field label="Arguments" value={form.args} placeholder="-y @modelcontextprotocol/server-filesystem /data/data/com.termux/files/home" onChange={(v) => setForm((p) => ({ ...p, args: v }))} />
                <div className="space-y-2 rounded-lg border border-edge bg-void/30 p-3">
                  <div className="flex items-center justify-between"><span className="text-[10px] font-medium uppercase tracking-[0.16em] text-mute">Environment · saved privately</span><button onClick={() => setEnvRows((p) => [...p, { name: "", value: "" }])} className="text-[10px] text-gold">+ add variable</button></div>
                  {envRows.map((row, i) => (
                    <div key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
                      <input value={row.name} onChange={(e) => setEnvRows((p) => p.map((r, n) => n === i ? { ...r, name: e.target.value } : r))} placeholder="GITHUB_TOKEN" className="rounded-md border border-edge bg-void/70 px-2.5 py-2 font-mono text-[10px] text-ink outline-none" />
                      <input type="password" value={row.value} onChange={(e) => setEnvRows((p) => p.map((r, n) => n === i ? { ...r, value: e.target.value } : r))} placeholder="Value or ${EXISTING_ENV}" className="rounded-md border border-edge bg-void/70 px-2.5 py-2 text-[11px] text-ink outline-none" />
                      <button onClick={() => setEnvRows((p) => p.filter((_, n) => n !== i))} className="px-2 text-mute hover:text-alert">Remove</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-4">
              <label className="block sm:col-span-2"><span className="mb-1.5 block text-[10px] font-medium uppercase tracking-[0.16em] text-mute">Trust policy</span><select value={form.trust} onChange={(e) => setForm((p) => ({ ...p, trust: e.target.value }))} className="w-full rounded-lg border border-edge bg-void/60 px-3 py-2.5 text-xs text-ink outline-none"><option value="untrusted">Untrusted · approve writes</option><option value="full">Full trust</option></select></label>
              <Field label="Tool timeout (s)" value={form.timeout} placeholder="300" onChange={(v) => setForm((p) => ({ ...p, timeout: v }))} />
              <Field label="Connect timeout (s)" value={form.connectTimeout} placeholder="60" onChange={(v) => setForm((p) => ({ ...p, connectTimeout: v }))} />
            </div>

            <div className="flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-mute">
              <label className="flex items-center gap-2"><Toggle on={form.lazy} onChange={(v) => setForm((p) => ({ ...p, lazy: v }))} /> Lazy start</label>
              <label className="flex items-center gap-2"><Toggle on={form.parallel} onChange={(v) => setForm((p) => ({ ...p, parallel: v }))} /> Parallel tools</label>
            </div>

            <details className="rounded-lg border border-edge bg-void/30 px-3 py-2.5">
              <summary className="cursor-pointer text-[10px] font-medium uppercase tracking-[0.14em] text-mute">Advanced Hermes MCP options</summary>
              <p className="mt-2 text-[10px] leading-relaxed text-mute">Optional JSON fields from Hermes' MCP config schema (tool filtering, sampling, TLS, lifecycle). For env and header credentials use the secure fields above or reference existing variables with <span className="text-ink">${"{NAME}"}</span>.</p>
              <textarea value={form.advanced} onChange={(e) => setForm((p) => ({ ...p, advanced: e.target.value }))} rows={5} placeholder={'{\n  "tools": { "include": ["search"], "resources": false },\n  "keepalive_interval": 60\n}'} className="mt-2 w-full resize-y rounded-lg border border-edge bg-void/70 px-3 py-2 font-mono text-[10px] text-ink outline-none focus:border-gold/30" />
            </details>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-edge pt-4">
              <p className="max-w-lg text-[10px] leading-relaxed text-mute">Saved to the active profile's <span className="text-gold">config.yaml</span> using Hermes' config writer. New sessions pick up the connection; running sessions can use <span className="text-ink">/reload-mcp</span>.</p>
              <button disabled={!online || busy === "save" || !form.name.trim()} onClick={saveServer} className="rounded-full bg-gold px-5 py-2.5 text-[11px] font-semibold text-void transition hover:bg-gold/90 disabled:opacity-40">{busy === "save" ? "Saving…" : "Save connection"}</button>
            </div>
          </div>
        </Panel>
      )}

      {notice && <Result notice={notice} />}

      <Panel title="Expose Hermes to another MCP client" className="mt-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-[11px] leading-relaxed text-mute">Hermes can also serve its messaging conversations and channel bridge to external MCP clients. The server uses stdio; the client manages its process lifecycle.</p>
          <button onClick={() => navigator.clipboard?.writeText('{\n  "command": "hermes",\n  "args": ["mcp", "serve"]\n}')} className="rounded-full border border-edge2 px-3 py-1.5 text-[10px] text-ink hover:border-gold/40 hover:text-gold">Copy client config</button>
        </div>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-edge bg-void/60 p-3 font-mono text-[10px] leading-relaxed text-teal/85">{'{\n  "command": "hermes",\n  "args": ["mcp", "serve"]\n}'}</pre>
        <p className="mt-2 text-[10px] text-mute">External tools include conversation list/read, messaging, channel discovery, events, and approvals. Sending messages requires the Hermes gateway to be running.</p>
      </Panel>
    </div>
  );
}

function Field({ label, value, placeholder, onChange }: { label: string; value: string; placeholder?: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-[0.16em] text-mute">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoCapitalize="none" autoCorrect="off" spellCheck={false} className="w-full rounded-lg border border-edge bg-void/60 px-3 py-2.5 text-xs text-ink placeholder-mute/50 outline-none focus:border-gold/30" />
    </label>
  );
}

function ServerRow({
  server, online, busy, toolsOpen, toolRows, selectedTools, toolFlags,
  onAction, onToggleFilters, onSelectTool, onToolFlag, onSaveTools,
}: {
  server: McpServer;
  online: boolean;
  busy: string | null;
  toolsOpen: boolean;
  toolRows: Array<{ name: string; description: string }>;
  selectedTools: string[];
  toolFlags: { resources: boolean; prompts: boolean };
  onAction: (name: string, action: "test" | "enable" | "disable" | "remove" | "login" | "catalog-install") => void;
  onToggleFilters: () => void;
  onSelectTool: (name: string) => void;
  onToolFlag: (key: "resources" | "prompts", value: boolean) => void;
  onSaveTools: (name: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const shortTarget = server.transport === "http" ? server.url : [server.command, ...(server.args ?? [])].filter(Boolean).join(" ");
  const busyAction = (action: string) => busy === server.name + action;

  return (
    <div className="border-b border-edge/80 last:border-0">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
        <button onClick={() => setExpanded((p) => !p)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-edge2 text-[10px] font-semibold uppercase tracking-wide text-gold hover:border-gold/40">
          {server.transport === "http" ? "HTTP" : "IO"}
        </button>
        <button onClick={() => setExpanded((p) => !p)} className="min-w-0 flex-1 text-left">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-ink">{server.name}</span>
            <span className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-mute"><Led color={server.enabled ? "mint" : "mute"} /> {server.enabled ? "Enabled" : "Disabled"}</span>
          </span>
          <span className="mt-0.5 block truncate font-mono text-[10px] text-mute">{shortTarget}</span>
        </button>
        <div className="hidden items-center gap-1.5 text-[9px] text-mute sm:flex">
          {server.auth === "oauth" && <Badge tone="teal">OAuth</Badge>}
          {server.trust === "untrusted" && <Badge tone="warn">approval-gated</Badge>}
          {server.lazy && <Badge tone="mute">lazy</Badge>}
        </div>
        <Toggle on={server.enabled} onChange={(v) => onAction(server.name, v ? "enable" : "disable")} />
      </div>

      {expanded && (
        <div className="space-y-3 px-4 pb-4 pl-16">
          <div className="flex flex-wrap gap-2">
            <SmallButton disabled={!online || !!busy} onClick={() => onAction(server.name, "test")}>{busyAction("test") ? "Testing…" : "Test connection"}</SmallButton>
            {server.auth === "oauth" && <SmallButton disabled={!online || !!busy} onClick={() => onAction(server.name, "login")}>{busyAction("login") ? "Waiting for authorization…" : "Authorize"}</SmallButton>}
            <SmallButton disabled={!online || !!busy} onClick={() => { onToggleFilters(); onAction(server.name, "test"); }}>{toolsOpen ? "Refresh tools" : "Inspect tools"}</SmallButton>
            <SmallButton destructive disabled={!online || !!busy} onClick={() => { if (confirm(`Remove ${server.name} from Hermes MCP config?`)) onAction(server.name, "remove"); }}>Remove</SmallButton>
            <button onClick={() => setShowConfig((p) => !p)} className="px-2 text-[10px] text-mute hover:text-ink">{showConfig ? "Hide config" : "View config"}</button>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-mute">
            <span>Transport <span className="text-ink">{server.transport === "http" ? (server.config.transport === "sse" ? "HTTP + SSE" : "Streamable HTTP") : "stdio"}</span></span>
            <span>Trust <span className="text-ink">{server.trust}</span></span>
            {server.env_keys.length > 0 && <span>Environment <span className="text-ink">{server.env_keys.length} variables</span></span>}
            {server.header_keys.length > 0 && <span>Headers <span className="text-ink">{server.header_keys.join(", ")}</span></span>}
            {server.tool_filter.include && <span>Tools <span className="text-ink">{server.tool_filter.include.length} allowed</span></span>}
            {server.tool_filter.exclude && <span>Tools <span className="text-ink">{server.tool_filter.exclude.length} excluded</span></span>}
          </div>
          {showConfig && <pre className="max-h-64 overflow-auto rounded-lg border border-edge bg-void/60 p-3 font-mono text-[9px] leading-relaxed text-ink/75">{JSON.stringify(server.config, null, 2)}</pre>}

          {toolsOpen && (
            <div className="rounded-lg border border-edge bg-void/30 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] font-medium text-ink">Discovered tools</div>
                  <div className="mt-0.5 text-[10px] text-mute">Select the tools Hermes may call. Leaving all selected keeps the server's full surface.</div>
                </div>
                <span className="text-[10px] tabular-nums text-teal">{selectedTools.length}/{toolRows.length}</span>
              </div>
              {toolRows.length ? (
                <div className="mt-3 max-h-56 space-y-1 overflow-y-auto">
                  {toolRows.map((tool) => (
                    <label key={tool.name} className="flex cursor-pointer items-start gap-2 border-b border-edge/50 py-1.5 last:border-0">
                      <input type="checkbox" checked={selectedTools.includes(tool.name)} onChange={() => onSelectTool(tool.name)} className="mt-0.5 accent-[#c4a875]" />
                      <span className="min-w-0"><span className="font-mono text-[10px] text-teal">{tool.name}</span><span className="ml-2 text-[10px] text-mute">{tool.description}</span></span>
                    </label>
                  ))}
                </div>
              ) : <div className="py-3 text-[10px] text-mute">Run a connection test to discover tool definitions.</div>}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-edge pt-3">
                <div className="flex gap-4 text-[10px] text-mute">
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={toolFlags.resources} onChange={(e) => onToolFlag("resources", e.target.checked)} className="accent-[#c4a875]" /> Resources</label>
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={toolFlags.prompts} onChange={(e) => onToolFlag("prompts", e.target.checked)} className="accent-[#c4a875]" /> Prompts</label>
                </div>
                <button disabled={!online || !!busy || !toolRows.length} onClick={() => onSaveTools(server.name)} className="rounded-full border border-gold/40 px-3 py-1.5 text-[10px] font-medium text-gold hover:bg-gold/10 disabled:opacity-40">{busyAction("filters") ? "Saving…" : "Save tool policy"}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SmallButton({ children, onClick, disabled, destructive = false }: { children: ReactNode; onClick: () => void; disabled?: boolean; destructive?: boolean }) {
  return <button onClick={onClick} disabled={disabled} className={cn("rounded-full border px-3 py-1.5 text-[10px] transition disabled:opacity-40", destructive ? "border-alert/25 text-alert/80 hover:border-alert/50" : "border-edge2 text-ink hover:border-gold/35 hover:text-gold")}>{children}</button>;
}

function Result({ notice }: { notice: McpResult }) {
  const text = notice.stdout || notice.stderr || notice.error || "(no output)";
  return (
    <div className={cn("rounded-lg border px-4 py-3", notice.ok ? "border-mint/20 bg-mint/[0.04]" : "border-alert/20 bg-alert/[0.04]")}>
      <div className={cn("text-[10px] font-semibold uppercase tracking-[0.16em]", notice.ok ? "text-mint" : "text-alert")}>{notice.ok ? "Hermes MCP updated" : `Hermes returned exit ${notice.code ?? 1}`}</div>
      <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-ink/80">{text}</pre>
      {!notice.ok && <p className="mt-2 text-[10px] text-mute">For interactive OAuth/catalog setup, use <span className="text-gold">hermes mcp login</span> or <span className="text-gold">hermes mcp install</span> directly in Termux.</p>}
    </div>
  );
}