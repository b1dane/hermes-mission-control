import { useState } from "react";
import { defaultEndpoint, type Health } from "../api";
import { usePersisted, type LinkState } from "../hooks";
import { Badge, Led, Panel, Toggle } from "../components/ui";

export interface Prefs {
  endpoint: string;
  token: string;
  scanlines: boolean;
  wakeLock: boolean;
  notifications: boolean;
  compact: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  endpoint: defaultEndpoint(),
  token: "",
  scanlines: false,
  wakeLock: true,
  notifications: true,
  compact: false,
};

export function usePrefs() {
  return usePersisted<Prefs>("hermes.mc.prefs", DEFAULT_PREFS);
}

export default function Settings({
  prefs,
  setPrefs,
  link,
  latency,
  health,
  error,
}: {
  prefs: Prefs;
  setPrefs: React.Dispatch<React.SetStateAction<Prefs>>;
  link: LinkState;
  latency: number | null;
  health: Health | null;
  error: string | null;
}) {
  const [draft, setDraft] = useState(prefs.endpoint);
  const [tokenDraft, setTokenDraft] = useState(prefs.token);

  const apply = () =>
    setPrefs((p) => ({ ...p, endpoint: draft.trim() || defaultEndpoint(), token: tokenDraft.trim() }));

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Panel
        title="Agent Link · Python bridge"
        right={
          link === "online" ? (
            <Badge tone="mint"><Led color="mint" pulse /> LINKED{latency != null ? ` ${latency}ms` : ""}</Badge>
          ) : link === "probing" ? (
            <Badge tone="warn"><Led color="warn" pulse /> PROBING</Badge>
          ) : (
            <Badge tone="gold"><Led color="gold" pulse /> DEMO MODE</Badge>
          )
        }
      >
        <label className="mb-1 block text-[10px] uppercase tracking-widest text-mute">Bridge URL</label>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="w-full rounded-md border border-edge bg-void/60 px-2.5 py-2 text-xs text-ink outline-none focus:border-gold/40"
        />
        <label className="mb-1 mt-2 block text-[10px] uppercase tracking-widest text-mute">Token (only if started with --token)</label>
        <div className="flex gap-2">
          <input
            value={tokenDraft}
            onChange={(e) => setTokenDraft(e.target.value)}
            type="password"
            autoCapitalize="none"
            placeholder="optional"
            className="min-w-0 flex-1 rounded-md border border-edge bg-void/60 px-2.5 py-2 text-xs text-ink outline-none focus:border-gold/40"
          />
          <button onClick={apply} className="rounded-md border border-gold/50 bg-gold/15 px-3 text-[10px] font-bold uppercase tracking-wider text-gold transition-colors hover:bg-gold/25">
            Connect
          </button>
        </div>

        {health ? (
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-edge pt-2 text-[10px]">
            <dt className="text-mute">hermes</dt>
            <dd className={health.hermes_found ? "text-mint" : "text-alert"}>
              {health.hermes_found ? `${health.hermes_bin} · v${health.version ?? "?"}` : "not found on PATH — pkg install hermes-agent"}
            </dd>
            <dt className="text-mute">home</dt>
            <dd className={health.home_exists ? "text-ink" : "text-warn"}>{health.hermes_home}{health.home_exists ? "" : " (missing — run hermes setup)"}</dd>
            <dt className="text-mute">platform</dt>
            <dd className="text-ink">{health.termux ? "Termux / Android" : "generic"} · python {health.python}</dd>
            <dt className="text-mute">auth</dt>
            <dd className="text-ink">{health.auth ? "token required" : "loopback, no token"}</dd>
          </dl>
        ) : (
          <p className="mt-3 border-t border-edge pt-2 text-[10px] leading-relaxed text-mute">
            {error ? <span className="text-alert">probe failed: {error}. </span> : null}
            Start the bridge in Termux: <span className="text-gold">python server/hermes_mc.py</span> (or <span className="text-gold">bash start.sh</span>). It serves this UI and drives the <span className="text-teal">hermes</span> CLI via subprocess. Retries every 15s.
          </p>
        )}
      </Panel>

      <Panel title="Display & Device">
        <ul className="divide-y divide-edge/60">
          {(
            [
              ["scanlines", "Subtle display texture", "Optional, off by default"],
              ["wakeLock", "Request wake lock", "start.sh calls termux-wake-lock while running"],
              ["notifications", "Push notifications", "Deliver cron results via termux-notification"],
              ["compact", "Compact density", "Tighter spacing for small screens"],
            ] as const
          ).map(([key, label, sub]) => (
            <li key={key} className="flex items-center justify-between gap-3 py-2.5">
              <div>
                <div className="text-xs text-ink">{label}</div>
                <div className="text-[10px] text-mute">{sub}</div>
              </div>
              <Toggle on={prefs[key]} onChange={(v) => setPrefs((p) => ({ ...p, [key]: v }))} />
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Termux Quickstart" className="lg:col-span-2">
        <div className="overflow-x-auto rounded-md border border-edge bg-void/70 p-3 text-[10px] leading-relaxed">
          <pre className="text-ink/85">
            <span className="text-mute"># 1 · packages (termux-api gives battery + notifications)</span>{"\n"}
            <span className="text-teal">pkg</span> install python nodejs-lts git termux-api hermes-agent{"\n"}
            <span className="text-teal">hermes</span> setup{"\n\n"}
            <span className="text-mute"># 2 · this dashboard</span>{"\n"}
            <span className="text-teal">git</span> clone &lt;repo&gt; ~/hermes-mission-control && <span className="text-teal">cd</span> ~/hermes-mission-control{"\n"}
            <span className="text-teal">bash</span> start.sh            <span className="text-mute"># builds once, serves 127.0.0.1:8664, opens browser</span>{"\n\n"}
            <span className="text-mute"># 3 · optional: reach it from other devices via Tailscale</span>{"\n"}
            <span className="text-teal">bash</span> start.sh --lan      <span className="text-mute"># binds 0.0.0.0 with a generated token</span>{"\n\n"}
            <span className="text-mute"># API surface (stdlib python, no pip)</span>{"\n"}
            <span className="text-gold">GET</span>  /api/health /api/status /api/sessions /api/cron /api/skills /api/memory /api/logs /api/mcp /api/mcp/catalog{"\n"}
            <span className="text-gold">POST</span> /api/exec /api/cron/action /api/mcp/action /api/mcp/save /api/mcp/filter /api/chat (SSE)
          </pre>
        </div>
        <p className="mt-2 text-[10px] text-mute">
          Everything stays on-device. Chat turns run <span className="text-teal">hermes chat -q … --format stream-json</span>; the console runs any non-interactive <span className="text-teal">hermes</span> subcommand.
        </p>
      </Panel>
    </div>
  );
}
