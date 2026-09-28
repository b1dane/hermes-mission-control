import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HermesApi, type Health, type Status } from "./api";

// ── localStorage persistence ────────────────────────────────────────────
export function usePersisted<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return initial;
      const saved = JSON.parse(raw) as T;
      if (isRecord(initial) && isRecord(saved)) {
        return { ...initial, ...saved } as T;
      }
      return saved;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage full / private mode */
    }
  }, [key, value]);
  return [value, setValue] as const;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ── ticking clock ───────────────────────────────────────────────────────
export function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function fmtDuration(s: number) {
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(Math.floor(s % 60)).padStart(2, "0");
  return `${h}:${m}:${ss}`;
}

// ── uptime counter (real device uptime when linked, simulated otherwise) ──
export function useUptime(realSeconds?: number | null) {
  const [text, setText] = useState("00:00:00");
  const anchor = useRef<{ at: number; base: number } | null>(null);
  useEffect(() => {
    if (realSeconds != null) anchor.current = { at: Date.now(), base: realSeconds };
  }, [realSeconds]);
  useEffect(() => {
    const KEY = "hermes.mc.boot";
    let boot = Number(sessionStorage.getItem(KEY));
    if (!boot) {
      boot = Date.now() - (4 * 3600 + 23 * 60 + 11) * 1000;
      sessionStorage.setItem(KEY, String(boot));
    }
    const tick = () => {
      const a = anchor.current;
      const s = a ? a.base + (Date.now() - a.at) / 1000 : (Date.now() - boot) / 1000;
      setText(fmtDuration(s));
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  return text;
}

// ── agent link (bridge probe) ───────────────────────────────────────────
export type LinkState = "probing" | "online" | "demo";

export function useAgentLink(endpoint: string, token: string) {
  const api = useMemo(() => new HermesApi(endpoint, token), [endpoint, token]);
  const [state, setState] = useState<LinkState>("probing");
  const [latency, setLatency] = useState<number | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  const probe = useCallback(async () => {
    const t0 = performance.now();
    try {
      const h = await api.health();
      setHealth(h);
      setLatency(Math.round(performance.now() - t0));
      setState("online");
      setError(null);
    } catch (e) {
      setHealth(null);
      setLatency(null);
      setState("demo");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [api]);

  useEffect(() => {
    setState("probing");
    probe();
    const id = setInterval(probe, 15000);
    return () => clearInterval(id);
  }, [probe]);

  return { api, state, latency, health, error, reprobe: probe };
}

// ── generic poller with demo fallback ───────────────────────────────────
export function useLive<T>(
  online: boolean,
  fetcher: () => Promise<T>,
  intervalMs: number,
  deps: unknown[] = [],
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!online) {
      setData(null);
      return;
    }
    let dead = false;
    const go = async () => {
      setLoading(true);
      try {
        const d = await fetcher();
        if (!dead) {
          setData(d);
          setError(null);
        }
      } catch (e) {
        if (!dead) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!dead) setLoading(false);
      }
    };
    go();
    const id = intervalMs > 0 ? setInterval(go, intervalMs) : undefined;
    return () => {
      dead = true;
      if (id) clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, intervalMs, tick, ...deps]);

  return { data, loading, error, refresh };
}

// ── telemetry: real when linked, random-walk otherwise ──────────────────
export interface Telemetry {
  cpu: number;
  mem: number;
  battery: number;
  charging: boolean;
  temp: number;
  netDown: number;
  netUp: number;
  tokMin: number;
  ctx: number;
  cpuHist: number[];
  tokHist: number[];
  netHist: number[];
  live: boolean;
  status: Status | null;
}

function walk(v: number, step: number, min: number, max: number) {
  const n = v + (Math.random() - 0.5) * step;
  return Math.min(max, Math.max(min, n));
}

const H = 40;

export function useTelemetry(api: HermesApi, online: boolean): Telemetry {
  const [t, setT] = useState<Telemetry>(() => ({
    cpu: 23,
    mem: 41,
    battery: 84,
    charging: true,
    temp: 33.5,
    netDown: 42,
    netUp: 11,
    tokMin: 820,
    ctx: 38,
    cpuHist: Array.from({ length: H }, () => 15 + Math.random() * 25),
    tokHist: Array.from({ length: H }, () => 500 + Math.random() * 700),
    netHist: Array.from({ length: H }, () => 20 + Math.random() * 60),
    live: false,
    status: null,
  }));

  // simulated walk
  useEffect(() => {
    if (online) return;
    const id = setInterval(() => {
      setT((p) => {
        const cpu = walk(p.cpu, 14, 4, 96);
        const tokMin = walk(p.tokMin, 260, 80, 2400);
        const netDown = walk(p.netDown, 30, 2, 240);
        return {
          ...p,
          live: false,
          status: null,
          cpu,
          mem: walk(p.mem, 4, 28, 78),
          battery: Math.max(5, p.battery + (p.charging ? 0.01 : -0.02)),
          temp: walk(p.temp, 0.6, 28, 44),
          netDown,
          netUp: walk(p.netUp, 8, 1, 90),
          tokMin,
          ctx: walk(p.ctx, 2, 12, 88),
          cpuHist: [...p.cpuHist.slice(1), cpu],
          tokHist: [...p.tokHist.slice(1), tokMin],
          netHist: [...p.netHist.slice(1), netDown],
        };
      });
    }, 2000);
    return () => clearInterval(id);
  }, [online]);

  // real samples
  useEffect(() => {
    if (!online) return;
    let dead = false;
    let first = true;
    const go = async () => {
      try {
        const s = await api.status();
        if (dead) return;
        setT((p) => {
          const reset = first; // wipe the simulated history on first real sample
          first = false;
          const base = (hist: number[], v: number) => (reset ? Array(H).fill(v) : [...hist.slice(1), v]);
          const tokMin = s.hermes.sessions_total; // proxy metric shown as "sessions" when live
          return {
            cpu: s.cpu,
            mem: s.mem,
            battery: s.battery ?? p.battery,
            charging: s.charging ?? false,
            temp: s.temp ?? s.batt_temp ?? p.temp,
            netDown: s.rx_kbps,
            netUp: s.tx_kbps,
            tokMin,
            ctx: s.disk_pct,
            cpuHist: base(p.cpuHist, s.cpu),
            tokHist: base(p.tokHist, s.mem),
            netHist: base(p.netHist, s.rx_kbps),
            live: true,
            status: s,
          };
        });
      } catch {
        /* keep last */
      }
    };
    go();
    const id = setInterval(go, 3000);
    return () => {
      dead = true;
      clearInterval(id);
    };
  }, [api, online]);

  return t;
}
