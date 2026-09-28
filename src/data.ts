// ── Types ────────────────────────────────────────────────────────────────
export type SessionStatus = "active" | "idle" | "archived";
export interface Session {
  id: string;
  title: string;
  platform: "cli" | "telegram" | "discord" | "cron" | "subagent";
  model: string;
  tokens: number;
  cost: number;
  messages: number;
  startedAt: string;
  status: SessionStatus;
  lastActivity: string;
}

export interface CronJob {
  id: string;
  name: string;
  expr: string;
  human: string;
  delivery: string;
  lastRun: string;
  nextRun: string;
  enabled: boolean;
  lastStatus: "ok" | "fail" | "pending";
  runs: number;
}

export interface Skill {
  id: string;
  name: string;
  desc: string;
  category: string;
  uses: number;
  source: "built-in" | "learned" | "hub";
  version: string;
}

export interface Channel {
  id: string;
  name: string;
  glyph: string;
  status: "connected" | "paused" | "error" | "off";
  today: number;
}

export interface MemoryEntry {
  id: string;
  kind: "fact" | "preference" | "project" | "person";
  content: string;
  updated: string;
}

export type LogLevel = "info" | "warn" | "error" | "tool" | "cron" | "agent";
export interface LogLine {
  id: number;
  ts: string;
  level: LogLevel;
  source: string;
  msg: string;
}

// ── Seed data ────────────────────────────────────────────────────────────
export const SESSIONS: Session[] = [
  { id: "s-9f2c", title: "Refactor Termux backup script", platform: "cli", model: "Hermes-4-405B", tokens: 48_213, cost: 0.42, messages: 34, startedAt: "09:14", status: "active", lastActivity: "just now" },
  { id: "s-b71a", title: "Daily briefing → Telegram", platform: "cron", model: "Hermes-4-70B", tokens: 12_940, cost: 0.08, messages: 6, startedAt: "07:00", status: "idle", lastActivity: "3h ago" },
  { id: "s-3dd0", title: "Research: local LLM quantization", platform: "telegram", model: "Hermes-4-405B", tokens: 88_402, cost: 0.91, messages: 52, startedAt: "yesterday", status: "idle", lastActivity: "14h ago" },
  { id: "s-77e4", title: "Subagent: repo test sweep", platform: "subagent", model: "Hermes-4-70B", tokens: 31_007, cost: 0.19, messages: 18, startedAt: "yesterday", status: "archived", lastActivity: "1d ago" },
  { id: "s-c052", title: "Discord: server mod triage", platform: "discord", model: "Hermes-4-70B", tokens: 9_311, cost: 0.05, messages: 22, startedAt: "2d ago", status: "archived", lastActivity: "2d ago" },
];

export const CRON_JOBS: CronJob[] = [
  { id: "c1", name: "Morning briefing", expr: "0 7 * * *", human: "Daily · 07:00", delivery: "Telegram", lastRun: "07:00 today", nextRun: "07:00 tomorrow", enabled: true, lastStatus: "ok", runs: 148 },
  { id: "c2", name: "Nightly ~/storage backup", expr: "30 2 * * *", human: "Daily · 02:30", delivery: "Local + log", lastRun: "02:30 today", nextRun: "02:30 tomorrow", enabled: true, lastStatus: "ok", runs: 91 },
  { id: "c3", name: "Weekly security audit", expr: "0 6 * * 1", human: "Mondays · 06:00", delivery: "Telegram", lastRun: "Mon 06:00", nextRun: "Mon 06:00", enabled: true, lastStatus: "ok", runs: 22 },
  { id: "c4", name: "RSS → digest summarizer", expr: "0 */4 * * *", human: "Every 4 hours", delivery: "Discord", lastRun: "12:00 today", nextRun: "16:00 today", enabled: false, lastStatus: "fail", runs: 310 },
  { id: "c5", name: "Battery + storage report", expr: "0 21 * * *", human: "Daily · 21:00", delivery: "Notification", lastRun: "21:00 yest.", nextRun: "21:00 today", enabled: true, lastStatus: "ok", runs: 64 },
];

export const SKILLS: Skill[] = [
  { id: "k1", name: "termux-device-report", desc: "Battery, thermals, storage & net status via termux-api", category: "device", uses: 212, source: "learned", version: "1.4.0" },
  { id: "k2", name: "web-research", desc: "Multi-source search, extract, cite and synthesize", category: "research", uses: 187, source: "built-in", version: "2.1.0" },
  { id: "k3", name: "git-flow", desc: "Branch, commit, PR etiquette with conventional commits", category: "dev", uses: 154, source: "built-in", version: "1.9.2" },
  { id: "k4", name: "sqlite-memory-audit", desc: "Inspect & compact the layered memory store", category: "memory", uses: 43, source: "learned", version: "0.3.1" },
  { id: "k5", name: "youtube-transcript-digest", desc: "Pull transcripts and produce timestamped digests", category: "research", uses: 77, source: "hub", version: "1.0.4" },
  { id: "k6", name: "android-notification", desc: "Rich local notifications through termux-notification", category: "device", uses: 301, source: "learned", version: "2.0.0" },
  { id: "k7", name: "expense-ledger", desc: "Parse receipts into a monthly CSV ledger", category: "personal", uses: 29, source: "hub", version: "0.9.0" },
  { id: "k8", name: "cron-composer", desc: "Natural language → validated crontab entries", category: "automation", uses: 96, source: "built-in", version: "1.2.3" },
];

export const CHANNELS: Channel[] = [
  { id: "tg", name: "Telegram", glyph: "✈", status: "connected", today: 46 },
  { id: "dc", name: "Discord", glyph: "◈", status: "connected", today: 12 },
  { id: "wa", name: "WhatsApp", glyph: "☏", status: "paused", today: 0 },
  { id: "sg", name: "Signal", glyph: "◍", status: "off", today: 0 },
  { id: "sl", name: "Slack", glyph: "♯", status: "error", today: 3 },
  { id: "ha", name: "Home Assistant", glyph: "⌂", status: "connected", today: 8 },
];

export const MEMORY: MemoryEntry[] = [
  { id: "m1", kind: "preference", content: "User prefers concise answers with code-first examples; metric units.", updated: "2h ago" },
  { id: "m2", kind: "project", content: "hermes-dotfiles repo: Termux setup scripts, zsh + tmux config, synced to GitHub.", updated: "5h ago" },
  { id: "m3", kind: "fact", content: "Device: Pixel 8 Pro, aarch64, Termux via F-Droid, termux-api installed.", updated: "1d ago" },
  { id: "m4", kind: "person", content: "Operator handle: @operator. Timezone Europe/Berlin. Morning briefing at 07:00.", updated: "3d ago" },
  { id: "m5", kind: "project", content: "quant-notes: ongoing research on 4-bit quantization for on-device inference.", updated: "6d ago" },
];

// ── Log stream simulation ────────────────────────────────────────────────
export const LOG_POOL: Array<{ level: LogLevel; source: string; msg: string }> = [
  { level: "info", source: "gateway", msg: "telegram: long-poll heartbeat ok (218ms)" },
  { level: "tool", source: "terminal", msg: "exec: termux-battery-status → 200 ok" },
  { level: "agent", source: "loop", msg: "turn complete · 1,204 tokens · 3 tool calls" },
  { level: "cron", source: "scheduler", msg: "job 'battery report' armed → next 21:00" },
  { level: "info", source: "memory", msg: "consolidated 3 entries into layered store" },
  { level: "tool", source: "web", msg: "fetch: docs page parsed, 14kb extracted" },
  { level: "warn", source: "gateway", msg: "slack: token refresh required, retrying in 60s" },
  { level: "agent", source: "subagent", msg: "spawn: test-sweep worker attached (pid 8123)" },
  { level: "info", source: "skills", msg: "skill 'android-notification' matched intent" },
  { level: "tool", source: "terminal", msg: "exec: git status --porcelain → clean" },
  { level: "info", source: "mcp", msg: "mcp server 'filesystem' capabilities refreshed" },
  { level: "error", source: "gateway", msg: "slack: 401 unauthorized — channel marked degraded" },
  { level: "agent", source: "loop", msg: "context window at 41% · pruning tool output" },
  { level: "cron", source: "scheduler", msg: "tick: 5 jobs scheduled, 4 enabled" },
  { level: "info", source: "device", msg: "wake-lock held · battery optimization off" },
  { level: "tool", source: "python", msg: "rpc pipeline finished in 0.8s (0 context cost)" },
];

export const CMD_HELP = [
  "  status        agent + device vitals",
  "  sessions      list active sessions",
  "  cron list     scheduled automations",
  "  skills        installed skills",
  "  gateway       channel status",
  "  model         current model info",
  "  mem           memory summary",
  "  clear         clear console",
];
