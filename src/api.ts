// Typed client for server/mc_bridge.py

export interface Health {
  ok: boolean;
  hermes_bin: string | null;
  hermes_found: boolean;
  hermes_home: string;
  home_exists: boolean;
  version: string | null;
  termux: boolean;
  python: string;
  bridge_uptime_s: number;
  auth: boolean;
}

export interface Status {
  cpu: number;
  mem: number;
  mem_used_mb: number;
  mem_total_mb: number;
  battery: number | null;
  charging: boolean | null;
  batt_temp: number | null;
  temp: number | null;
  disk_used_gb: number;
  disk_total_gb: number;
  disk_pct: number;
  rx_kbps: number;
  tx_kbps: number;
  uptime_s: number;
  load: number[];
  cores: number;
  hermes: {
    version: string | null;
    model: string | null;
    provider: string | null;
    gateway_running: boolean;
    gateway_pid: number | null;
    sessions_total: number;
    cron_total: number;
    cron_enabled: number;
    skills_total: number;
  };
}

export interface LiveSession {
  id: string;
  title: string;
  source: string;
  model: string | null;
  started: string | number | null;
  ended: string | number | null;
  tokens: number;
  cost: number;
  messages: number;
}

export interface LiveJob {
  id: string;
  name: string;
  schedule: string;
  prompt: string;
  enabled: boolean;
  state: string | null;
  deliver: string;
  last_run_at: string | null;
  next_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  runs: number | null;
  skills: string[];
  model: string | null;
  no_agent: boolean;
}

export interface LiveSkill {
  name: string;
  description: string;
  category: string;
  version: string | null;
  tags: string | null;
  path: string;
  updated: number;
}

export interface MemoryFile {
  name: string;
  path: string;
  content: string;
  updated: number;
}

export interface LiveLogLine {
  ts: string;
  level: string;
  source: string;
  msg: string;
}

export interface McpServer {
  name: string;
  enabled: boolean;
  transport: "http" | "stdio";
  url?: string | null;
  command?: string | null;
  args: string[];
  auth: string;
  trust: string;
  lazy: boolean;
  timeout?: number | null;
  connect_timeout?: number | null;
  parallel: boolean;
  tool_filter: {
    include?: string[] | null;
    exclude?: string[] | null;
    resources: boolean;
    prompts: boolean;
  };
  env_keys: string[];
  header_keys: string[];
  config: Record<string, unknown>;
}

export interface McpCatalogEntry {
  name: string;
  status: string;
  description: string;
}

export interface McpResult extends ExecResult {
  server?: string;
  tools?: Array<{ name: string; description: string }>;
  secret_keys?: string[];
  error?: string;
}

export interface ExecResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
  cmd?: string[];
  duration_ms?: number;
}

export interface ChatEvent {
  type: string;
  subtype?: string;
  text?: string;
  name?: string;
  input?: unknown;
  output?: string;
  is_error?: boolean;
  duration_ms?: number;
  session_id?: string;
  exit_code?: number;
  error?: string | null;
  msg?: string;
  cmd?: string;
  model?: string;
  tokens?: { input: number; output: number; total: number };
  stderr?: string;
}

export class HermesApi {
  constructor(
    public base: string,
    public token: string,
  ) {}

  private url(p: string) {
    return this.base.replace(/\/$/, "") + p;
  }

  private headers(json = false): HeadersInit {
    const h: Record<string, string> = {};
    if (json) h["Content-Type"] = "application/json";
    if (this.token) h["X-Hermes-Token"] = this.token;
    return h;
  }

  async get<T>(p: string, timeoutMs = 6000): Promise<T> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(this.url(p), { headers: this.headers(), signal: ctrl.signal });
      if (!r.ok) throw new Error(`${r.status}`);
      return (await r.json()) as T;
    } finally {
      clearTimeout(t);
    }
  }

  async post<T>(p: string, body: unknown, timeoutMs = 130000): Promise<T> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(this.url(p), {
        method: "POST",
        headers: this.headers(true),
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      return (await r.json()) as T;
    } finally {
      clearTimeout(t);
    }
  }

  health() {
    return this.get<Health>("/api/health", 3000);
  }
  status() {
    return this.get<Status>("/api/status");
  }
  sessions() {
    return this.get<{ sessions: LiveSession[]; total: number; source: string; raw?: string }>("/api/sessions");
  }
  cron() {
    return this.get<{ jobs: LiveJob[] }>("/api/cron");
  }
  skills() {
    return this.get<{ skills: LiveSkill[] }>("/api/skills");
  }
  memory() {
    return this.get<{ files: MemoryFile[] }>("/api/memory");
  }
  logs(n = 200, file = "agent") {
    return this.get<{ file: string | null; files: string[]; lines: LiveLogLine[] }>(`/api/logs?n=${n}&file=${file}`);
  }
  mcp() {
    return this.get<{ servers: McpServer[]; count: number; path: string }>("/api/mcp");
  }
  mcpCatalog() {
    return this.get<{ entries: McpCatalogEntry[]; raw: string; ok: boolean; error: string }>("/api/mcp/catalog", 60000);
  }
  mcpAction(action: "test" | "enable" | "disable" | "remove" | "login" | "catalog-install", name: string) {
    return this.post<McpResult>("/api/mcp/action", { action, name }, action === "login" ? 620000 : 180000);
  }
  saveMcp(body: unknown) {
    return this.post<McpResult>("/api/mcp/save", body, 60000);
  }
  filterMcp(name: string, tools: McpServer["tool_filter"]) {
    return this.post<McpResult>("/api/mcp/filter", { name, tools }, 60000);
  }
  installCatalog(name: string, secrets: Record<string, string> = {}) {
    return this.post<McpResult>("/api/mcp/catalog/install", { name, secrets }, 920000);
  }
  exec(cmd: string) {
    return this.post<ExecResult>("/api/exec", { cmd });
  }
  cronAction(action: string, id: string) {
    return this.post<ExecResult>("/api/cron/action", { action, id });
  }
  cronCreate(schedule: string, prompt: string, name?: string) {
    return this.post<ExecResult>("/api/cron/create", { schedule, prompt, name });
  }
  cancelChat() {
    return this.post<{ ok: boolean }>("/api/chat/cancel", {}, 5000);
  }

  /** Speak text through the device speaker via bridge. */
  async tts(text: string) {
    return this.post<{ ok: boolean }>("/api/tts", { text }, 35000);
  }

  /** Stream a chat turn; resolves when the stream closes. */
  async chat(
    body: { prompt: string; session_id?: string | null },
    onEvent: (e: ChatEvent) => void,
    signal?: AbortSignal,
  ) {
    const r = await fetch(this.url("/api/chat"), {
      method: "POST",
      headers: this.headers(true),
      body: JSON.stringify(body),
      signal,
    });
    if (!r.ok || !r.body) {
      let msg = `HTTP ${r.status}`;
      try {
        msg = ((await r.json()) as { error?: string }).error ?? msg;
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const line = chunk.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        try {
          onEvent(JSON.parse(line.slice(5).trim()) as ChatEvent);
        } catch {
          /* skip malformed */
        }
      }
    }
  }
}

/** Sensible default: same origin when served by the bridge, else the bridge's default port. */
export function defaultEndpoint() {
  if (typeof window !== "undefined" && window.location.protocol.startsWith("http")) {
    return window.location.origin;
  }
  return "http://127.0.0.1:8000";
}
