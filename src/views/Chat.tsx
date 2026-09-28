import { useEffect, useRef, useState } from "react";
import type { ChatEvent, HermesApi } from "../api";
import { usePersisted } from "../hooks";
import { Badge, Led, Panel } from "../components/ui";
import { cn } from "../utils/cn";

type Block =
  | { kind: "user"; text: string; id: number }
  | { kind: "assistant"; text: string; id: number; streaming: boolean }
  | { kind: "tool"; name: string; input?: unknown; output?: string; isError?: boolean; ms?: number; id: number }
  | { kind: "sys"; text: string; id: number; tone?: "mute" | "alert" | "mint" };

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
type NewBlock = DistributiveOmit<Block, "id">;

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> };
type RecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionCtor = new () => RecognitionLike;

let bid = 1;

export default function Chat({ api, online }: { api: HermesApi; online: boolean }) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = usePersisted<string | null>("hermes.mc.chat.session", null);
  const [continueSession, setContinueSession] = usePersisted("hermes.mc.chat.continue", true);
  const [readAloud, setReadAloud] = usePersisted("hermes.mc.chat.voice", false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [meta, setMeta] = useState<{ model?: string; tokens?: number; ms?: number }>({});
  const abortRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const answerRef = useRef("");
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [blocks]);

  const add = (b: NewBlock) => {
    const id = bid++;
    setBlocks((p) => [...p, { ...b, id } as Block]);
    return id;
  };

  const appendText = (id: number, text: string) =>
    setBlocks((p) => p.map((b) => (b.id === id && b.kind === "assistant" ? { ...b, text: b.text + text } : b)));

  const finishText = (id: number) =>
    setBlocks((p) => p.map((b) => (b.id === id && b.kind === "assistant" ? { ...b, streaming: false } : b)));

  const send = async () => {
    const prompt = input.trim();
    if (!prompt || busy) return;
    recognitionRef.current?.stop();
    setListening(false);
    setInterim("");
    setInput("");
    add({ kind: "user", text: prompt });
    if (!online) {
      add({ kind: "sys", text: "Demo mode — start server/hermes_mc.py in Termux to talk to your real agent.", tone: "alert" });
      return;
    }
    setBusy(true);
    answerRef.current = "";
    let cur = add({ kind: "assistant", text: "", streaming: true });
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const t0 = performance.now();
    let turnCompleted = false;
    try {
      await api.chat(
        { prompt, session_id: continueSession ? sessionId : null },
        (e: ChatEvent) => {
          switch (e.type) {
            case "system":
              if (e.session_id) setSessionId(e.session_id);
              if (e.model) setMeta((m) => ({ ...m, model: e.model }));
              break;
            case "text":
              answerRef.current += e.text ?? "";
              appendText(cur, e.text ?? "");
              break;
            case "tool_use":
              finishText(cur);
              add({ kind: "tool", name: e.name ?? "tool", input: e.input });
              cur = add({ kind: "assistant", text: "", streaming: true });
              break;
            case "tool_result":
              setBlocks((p) => {
                const idx = [...p].reverse().findIndex((b) => b.kind === "tool" && b.name === e.name && b.output === undefined);
                if (idx < 0) return p;
                const real = p.length - 1 - idx;
                return p.map((b, i) => (i === real && b.kind === "tool" ? { ...b, output: e.output, isError: e.is_error, ms: e.duration_ms } : b));
              });
              break;
            case "result":
              if (e.session_id) setSessionId(e.session_id);
              turnCompleted = e.exit_code === 0;
              setMeta((m) => ({ ...m, tokens: e.tokens?.total, ms: e.duration_ms ?? Math.round(performance.now() - t0) }));
              if (!answerRef.current && e.text) {
                answerRef.current = e.text;
                appendText(cur, e.text);
              }
              if (e.error) add({ kind: "sys", text: `✗ ${e.error}`, tone: "alert" });
              break;
            case "done":
              if (e.session_id) setSessionId(e.session_id);
              turnCompleted = e.exit_code === 0;
              if (e.exit_code && e.exit_code !== 0) add({ kind: "sys", text: `hermes exited ${e.exit_code}${e.stderr ? ` — ${e.stderr.split("\n").filter(Boolean).slice(-2).join(" · ")}` : ""}`, tone: "alert" });
              break;
            case "error":
              add({ kind: "sys", text: `bridge: ${e.error}`, tone: "alert" });
              break;
            case "bridge":
              add({ kind: "sys", text: e.msg ?? "" });
              break;
          }
        },
        ctrl.signal,
      );
    } catch (e) {
      add({ kind: "sys", text: ctrl.signal.aborted ? "cancelled" : `error: ${e instanceof Error ? e.message : String(e)}`, tone: "alert" });
    } finally {
      finishText(cur);
      setBlocks((p) => p.filter((b) => !(b.kind === "assistant" && b.text === "" && !b.streaming)));
      if (turnCompleted && readAloud && answerRef.current.trim()) {
        api.tts(answerRef.current.trim()).catch(() => {});
      }
      setBusy(false);
      abortRef.current = null;
    }
  };

  const toggleVoiceInput = () => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      setInterim("");
      return;
    }
    const speechWindow = window as Window & {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    const SpeechRecognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      add({ kind: "sys", text: "Voice input is not available in this browser. Try Chrome on Android or type your message.", tone: "alert" });
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      let draft = "";
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const item = event.results[i];
        if (item.isFinal) finalText += item[0].transcript;
        else draft += item[0].transcript;
      }
      setInterim(draft.trim());
      if (finalText.trim()) {
        setInput((p) => `${p}${p.trim() ? " " : ""}${finalText.trim()}`);
        setInterim("");
      }
    };
    recognition.onerror = (event) => {
      setListening(false);
      setInterim("");
      if (event.error && event.error !== "no-speech" && event.error !== "aborted") {
        add({ kind: "sys", text: `Voice input: ${event.error}`, tone: "alert" });
      }
    };
    recognition.onend = () => {
      setListening(false);
      setInterim("");
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      add({ kind: "sys", text: "Could not start the microphone. Check browser permission and try again.", tone: "alert" });
    }
  };

  const cancel = async () => {
    abortRef.current?.abort();
    try {
      await api.cancelChat();
    } catch {
      /* ignore */
    }
  };

  return (
    <Panel
      title="Conversation"
      pad={false}
      right={
        <div className="flex items-center gap-2">
          {meta.model && <span className="hidden text-[9px] text-mute sm:inline">{meta.model}</span>}
          {meta.tokens != null && <span className="text-[9px] tabular-nums text-teal">{meta.tokens} tok</span>}
          <button onClick={() => setReadAloud((v) => !v)} aria-pressed={readAloud} title={readAloud ? "Disable spoken replies" : "Read replies aloud"} className={cn("rounded-full border px-2.5 py-1 text-[9px] uppercase tracking-wider transition", readAloud ? "border-gold/35 text-gold" : "border-edge text-mute hover:text-ink")}>Voice {readAloud ? "on" : "off"}</button>
          <Badge tone={busy ? "gold" : online ? "mint" : "mute"}>
            <Led color={busy ? "gold" : online ? "mint" : "mute"} pulse={busy || online} /> {busy ? "THINKING" : online ? "READY" : "DEMO"}
          </Badge>
        </div>
      }
    >
      <div className="flex h-[calc(100dvh-230px)] min-h-[420px] flex-col lg:h-[calc(100dvh-170px)]">
        <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
          {blocks.length === 0 && (
            <div className="grid h-full place-items-center">
              <div className="max-w-sm text-center">
                <div className="text-3xl text-gold">☤</div>
                <p className="mt-2 text-xs text-ink">Talk to your Hermes Agent</p>
                <p className="mt-1 text-[10px] leading-relaxed text-mute">
                  Each message runs <span className="text-gold">hermes chat -q "…" --format stream-json</span> on this device and streams text, tool calls and results back here.
                  {continueSession ? " Turns resume the same session." : ""}
                </p>
                <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                  {["What's my battery and storage status?", "Summarize my cron jobs", "What did you learn recently?"].map((s) => (
                    <button key={s} onClick={() => setInput(s)} className="rounded border border-edge2 px-2 py-1 text-[9px] text-mute hover:border-gold/40 hover:text-gold">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {blocks.map((b) => (
            <BlockView key={b.id} b={b} />
          ))}
          <div ref={endRef} />
        </div>

        <div className="border-t border-edge p-2.5">
          <div className="mb-1.5 flex items-center gap-3 text-[9px] text-mute">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={continueSession} onChange={(e) => setContinueSession(e.target.checked)} className="accent-[#e8a44c]" />
              continue session
            </label>
            {sessionId && (
              <span className="truncate">
                session <span className="text-teal">{sessionId.slice(0, 14)}</span>
                <button
                  onClick={() => {
                    setSessionId(null);
                    setBlocks([]);
                    setMeta({});
                  }}
                  className="ml-2 text-gold hover:underline"
                >
                  new
                </button>
              </span>
            )}
            {meta.ms != null && <span className="ml-auto tabular-nums">{(meta.ms / 1000).toFixed(1)}s</span>}
          </div>
          {listening && <div className="mb-1.5 flex items-center gap-2 text-[10px] text-gold"><Led color="gold" pulse /> Listening{interim ? ` · ${interim}` : "…"}</div>}
          <div className="flex items-end gap-2">
            <textarea
              ref={taRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={2}
              placeholder={online ? "message hermes… (Enter to send, Shift+Enter newline)" : "connect the bridge to chat"}
              className="min-h-[44px] flex-1 resize-none rounded-md border border-edge bg-void/60 px-3 py-2 text-xs text-ink placeholder-mute/50 outline-none focus:border-gold/40"
            />
            <button onClick={toggleVoiceInput} aria-label={listening ? "Stop voice input" : "Start voice input"} aria-pressed={listening} title={listening ? "Stop listening" : "Dictate a message"} className={cn("grid h-[44px] w-[44px] shrink-0 place-items-center rounded-md border text-sm transition", listening ? "border-alert/50 bg-alert/10 text-alert" : "border-edge2 text-mute hover:border-gold/40 hover:text-gold")}>
              <MicGlyph active={listening} />
            </button>
            {busy ? (
              <button onClick={cancel} className="h-[44px] rounded-md border border-alert/50 bg-alert/10 px-4 text-[10px] font-bold uppercase tracking-wider text-alert hover:bg-alert/20">
                Stop
              </button>
            ) : (
              <button
                onClick={send}
                disabled={!input.trim()}
                className="h-[44px] rounded-md border border-gold/50 bg-gold/15 px-4 text-[10px] font-bold uppercase tracking-wider text-gold hover:bg-gold/25 disabled:opacity-40"
              >
                Send
              </button>
            )}
          </div>
          <p className="mt-1.5 text-[9px] leading-relaxed text-mute/75">
            Dictation uses your browser's speech recognizer; spoken replies use device speech. Recognition processing depends on Android/browser settings.
          </p>
        </div>
      </div>
    </Panel>
  );
}

function MicGlyph({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={cn("h-5 w-5", active && "animate-pulse")} aria-hidden="true">
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11v1a7 7 0 0 0 14 0v-1M12 19v3m-4 0h8" />
    </svg>
  );
}

function BlockView({ b }: { b: Block }) {
  const [open, setOpen] = useState(false);
  if (b.kind === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg rounded-br-sm border border-gold/30 bg-gold/10 px-3 py-2 text-xs text-ink">{b.text}</div>
      </div>
    );
  }
  if (b.kind === "assistant") {
    if (!b.text && !b.streaming) return null;
    return (
      <div className="flex gap-2">
        <span className="mt-1 shrink-0 text-gold">☤</span>
        <div className="max-w-[90%] whitespace-pre-wrap rounded-lg rounded-tl-sm border border-edge bg-panel2/70 px-3 py-2 text-xs leading-relaxed text-ink">
          {b.text}
          {b.streaming && <span className="caret-blink text-gold">▊</span>}
        </div>
      </div>
    );
  }
  if (b.kind === "tool") {
    return (
      <div className="ml-6 rounded-md border border-teal/25 bg-teal/5 text-[10px]">
        <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left">
          <Led color={b.output === undefined ? "warn" : b.isError ? "alert" : "teal"} pulse={b.output === undefined} />
          <span className="font-bold text-teal">{b.name}</span>
          {b.ms != null && <span className="text-mute">{b.ms}ms</span>}
          <span className="ml-auto text-mute">{open ? "▾" : "▸"}</span>
        </button>
        {open && (
          <div className="space-y-1.5 border-t border-teal/20 px-2.5 py-2">
            {b.input !== undefined && (
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-mute">{typeof b.input === "string" ? b.input : JSON.stringify(b.input, null, 1)}</pre>
            )}
            {b.output !== undefined && (
              <pre className={cn("max-h-48 overflow-auto whitespace-pre-wrap", b.isError ? "text-alert" : "text-ink/80")}>{b.output || "(empty)"}</pre>
            )}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className={cn("text-center text-[9px] italic", b.tone === "alert" ? "text-alert" : b.tone === "mint" ? "text-mint" : "text-mute")}>
      {b.text}
    </div>
  );
}
