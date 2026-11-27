import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../i18n";
import { useGameStore } from "../../state/gameStore";
import type { AgentAction } from "../../agent/agent-session";
import { formatForModel } from "../../agent/agent-format";
import { AgentHost, type AgentControl } from "./agent-host";
import {
  AgentPlayer, agentEfforts, agentModels, askAdvisor, describeApiError, emptyUsage,
  type AdvisorTurn, type AgentEffort, type AgentEnd, type AgentModel, type AgentSettings, type AgentUsage,
} from "./agent-brain";
import "./agent.css";

/**
 * Polypiled: the AI agent's panel. Let Claude play the game on screen and
 * watch it, take over at any time (any key or click on the game does), or
 * ask it about the current game (#askagent opens the Ask tab).
 */

const SETTINGS_KEY = "polypiled.agent.settings";
const API_KEY_KEY = "polypiled.agent.apiKey";

const languageNames: Record<string, string> = {
  en: "English", ja: "Japanese", de: "German", es: "Spanish", fi: "Finnish", fr: "French",
  ko: "Korean", "pt-br": "Brazilian Portuguese", ru: "Russian", "zh-cn": "Simplified Chinese",
};

interface StoredSettings { model: AgentModel; effort: AgentEffort; budgetUsd: number; paceMs: number }
const defaultSettings: StoredSettings = { model: "claude-opus-5-5", effort: "medium", budgetUsd: 5, paceMs: 400 };

function loadSettings(): StoredSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<StoredSettings>;
    return {
      model: agentModels.includes(saved.model as AgentModel) ? saved.model as AgentModel : defaultSettings.model,
      effort: agentEfforts.includes(saved.effort as AgentEffort) ? saved.effort as AgentEffort : defaultSettings.effort,
      budgetUsd: Number.isFinite(saved.budgetUsd) && (saved.budgetUsd as number) > 0 ? saved.budgetUsd as number : defaultSettings.budgetUsd,
      paceMs: Number.isFinite(saved.paceMs) ? Math.min(3000, Math.max(0, saved.paceMs as number)) : defaultSettings.paceMs,
    };
  } catch {
    return defaultSettings;
  }
}

type LogEntry = { id: number; kind: "text" | "thinking" | "action" | "system"; text: string };

function describeAction(action: AgentAction): string {
  if ("move" in action) return `move ${action.move}${action.count ? ` ×${action.count}` : ""}`;
  if ("keys" in action) return `keys ${action.keys.join(" ")}`;
  if ("extended" in action) return `#${action.extended}`;
  if ("answer" in action) return `answer ${action.answer}`;
  if ("select" in action) return `select ${action.select.map(choice => choice.index).join(",")}`;
  if ("text" in action) return `text "${action.text}"`;
  if ("position" in action) return `pick (${action.position.x}, ${action.position.y})`;
  if ("inventory" in action) return `${action.inventory.op}${"item" in action.inventory && action.inventory.item ? ` ${action.inventory.item}` : ""}`;
  return "dismiss";
}

type Tab = "play" | "ask" | "settings";

/**
 * Buttons of the panel must not keep the keyboard focus: the game's own
 * keys (Esc, i and the rest) would then go to the button instead of the game.
 */
const keepFocusOnGame = (event: { target: EventTarget | null; preventDefault(): void }) => {
  if ((event.target as HTMLElement | null)?.closest?.("button")) event.preventDefault();
};

export function AgentPanel(): JSX.Element | null {
  const engine = useGameStore(state => state.engineController);
  const { strings, locale } = useI18n();
  const t = strings.plus.agent;
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("play");
  const [control, setControl] = useState<AgentControl>("human");
  const [playing, setPlaying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [notes, setNotes] = useState("");
  const [usage, setUsage] = useState<AgentUsage>(emptyUsage());
  const [advisorCost, setAdvisorCost] = useState(0);
  const [showThinking, setShowThinking] = useState(false);
  const [settings, setSettings] = useState<StoredSettings>(loadSettings);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(API_KEY_KEY) ?? "");
  const [keyDraft, setKeyDraft] = useState("");
  const [savedNotice, setSavedNotice] = useState(false);
  const [chat, setChat] = useState<AdvisorTurn[]>([]);
  const [pending, setPending] = useState<{ question: string; answer: string } | null>(null);
  const [draft, setDraft] = useState("");
  const hostRef = useRef<AgentHost | null>(null);
  const playerRef = useRef<AgentPlayer | null>(null);
  const askAbort = useRef<AbortController | null>(null);
  const logId = useRef(0);
  const askInput = useRef<HTMLTextAreaElement | null>(null);
  const stringsRef = useRef(t);
  stringsRef.current = t;

  const addLog = useCallback((kind: LogEntry["kind"], text: string) => {
    setLog(entries => [...entries.slice(-199), { id: ++logId.current, kind, text }]);
  }, []);

  const endMessage = useCallback((reason: AgentEnd, detail?: string) => {
    const ended = stringsRef.current.ended;
    return reason === "error" ? ended.error(detail ?? "") : ended[reason];
  }, []);

  useEffect(() => {
    if (!engine) return;
    const host = new AgentHost(engine, {
      onControlChange: (next, reason) => {
        setControl(next);
        if (reason === "player" && next === "paused") setNotice(stringsRef.current.playerTookOver);
      },
      onAskAgent: () => {
        setOpen(true);
        setTab("ask");
        setTimeout(() => askInput.current?.focus(), 0);
      },
      onNewGame: () => {
        playerRef.current?.reset();
        setNotes("");
        addLog("system", stringsRef.current.newGame);
      },
    });
    host.stepDelayMs = loadSettings().paceMs;
    const player = new AgentPlayer(host, {
      onText: text => addLog("text", text),
      onThinking: text => addLog("thinking", text),
      onUsage: setUsage,
      onStep: step => addLog("action", `${describeAction(step.action)}${step.error ? ` — ${step.error}` : step.messages?.length ? ` — ${step.messages.join(" ")}` : ""}`),
      onNotes: setNotes,
      onEnd: (reason, detail) => {
        setPlaying(false);
        if (host.control === "agent") host.setControl("human", "agent");
        if (reason !== "stopped") setNotice(endMessage(reason, detail));
      },
    });
    hostRef.current = host;
    playerRef.current = player;
    return () => {
      player.stop();
      host.dispose();
      hostRef.current = null;
      playerRef.current = null;
    };
  }, [engine, addLog, endMessage]);

  const fullSettings = (): AgentSettings => ({
    apiKey, model: settings.model, effort: settings.effort, budgetUsd: settings.budgetUsd,
    language: languageNames[locale] ?? "English",
  });

  const updateSettings = (patch: Partial<StoredSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    if (patch.paceMs !== undefined && hostRef.current) hostRef.current.stepDelayMs = patch.paceMs;
  };

  const requireKey = (): boolean => {
    if (apiKey) return true;
    setTab("settings");
    setNotice(t.needKey);
    return false;
  };

  const startPlaying = () => {
    const host = hostRef.current, player = playerRef.current;
    if (!host || !player) { setNotice(t.noGame); return; }
    if (!requireKey()) return;
    setNotice(null);
    host.setControl("agent");
    if (!player.isRunning) {
      setPlaying(true);
      void player.play(fullSettings());
    }
  };

  const pause = () => hostRef.current?.setControl("paused");
  const takeOver = () => {
    hostRef.current?.setControl("human");
    playerRef.current?.stop();
  };

  const ask = async () => {
    const host = hostRef.current;
    const question = draft.trim();
    if (!question || pending) return;
    if (!host) { setNotice(t.noGame); return; }
    if (!requireKey()) return;
    setDraft("");
    setPending({ question, answer: "" });
    const state = `${formatForModel(host.snapshot())}\n\nInventory: ${JSON.stringify(host.inventory())}`;
    askAbort.current = new AbortController();
    try {
      const { answer, usage: spent } = await askAdvisor(fullSettings(), chat, question, state,
        delta => setPending(current => current && { ...current, answer: current.answer + delta }), askAbort.current.signal);
      setChat(turns => [...turns, { question, answer }]);
      setAdvisorCost(cost => cost + spent.costUsd);
    } catch (error) {
      setChat(turns => [...turns, { question, answer: t.ask.failed(describeApiError(error)) }]);
    } finally {
      setPending(null);
      askAbort.current = null;
    }
  };

  if (!engine) return null;

  const button = (
    <button type="button" className="nh3d-agent-button" data-agent-panel title={t.buttonTitle} aria-label={t.buttonTitle}
      data-control={control} onMouseDown={keepFocusOnGame} onClick={() => setOpen(value => !value)}>
      {t.button}
    </button>
  );

  if (!open) return createPortal(button, document.body);

  const controlLabel = t.control[control];
  return createPortal(
    <>
      {button}
      <aside className="nh3d-agent-panel" data-agent-panel aria-label={t.title} onMouseDown={keepFocusOnGame}>
        <header className="nh3d-agent-header">
          <strong>{t.title}</strong>
          <span className="nh3d-agent-control" data-control={control}>{controlLabel}</span>
          <button type="button" className="nh3d-agent-close" onClick={() => setOpen(false)} aria-label={t.close}>×</button>
        </header>
        <nav className="nh3d-agent-tabs" role="tablist">
          {(["play", "ask", "settings"] as const).map(name => (
            <button key={name} type="button" role="tab" aria-selected={tab === name} className={tab === name ? "is-active" : ""}
              onClick={() => setTab(name)}>{t.tabs[name]}</button>
          ))}
        </nav>
        {notice && <p className="nh3d-agent-notice" role="status">{notice}</p>}

        {tab === "play" && (
          <section className="nh3d-agent-body">
            <div className="nh3d-agent-actions">
              {control === "human" && <button type="button" onClick={startPlaying}>{t.start}</button>}
              {control === "agent" && <button type="button" onClick={pause}>{t.pause}</button>}
              {control === "paused" && <button type="button" onClick={startPlaying}>{t.resume}</button>}
              {control !== "human" && <button type="button" onClick={takeOver}>{t.takeOver}</button>}
            </div>
            <label className="nh3d-agent-field">
              <span>{t.pace}: {t.paceValue(settings.paceMs)}</span>
              <input type="range" min={0} max={3000} step={100} value={settings.paceMs}
                onChange={event => updateSettings({ paceMs: Number(event.target.value) })} />
            </label>
            <p className="nh3d-agent-cost" title={t.costHint}>{t.cost((usage.costUsd + advisorCost).toFixed(2), settings.budgetUsd.toFixed(2))}</p>
            <h3>{t.notes}</h3>
            <p className="nh3d-agent-notes">{notes || t.noNotes}</p>
            <h3>
              {t.log}
              <label className="nh3d-agent-inline">
                <input type="checkbox" checked={showThinking} onChange={event => setShowThinking(event.target.checked)} />
                {t.showThinking}
              </label>
            </h3>
            <ol className="nh3d-agent-log" aria-live="polite">
              {log.filter(entry => showThinking || entry.kind !== "thinking").slice(-80).map(entry => (
                <li key={entry.id} className={`is-${entry.kind}`}>{entry.text}</li>
              ))}
            </ol>
            {playing && control === "agent" && <span className="nh3d-agent-busy" aria-hidden="true" />}
          </section>
        )}

        {tab === "ask" && (
          <section className="nh3d-agent-body">
            <p className="nh3d-agent-hint">{t.ask.hint}</p>
            <ol className="nh3d-agent-chat">
              {[...chat, ...(pending ? [pending] : [])].map((turn, index) => (
                <li key={index}>
                  <p className="is-question">{turn.question}</p>
                  <p className="is-answer">{turn.answer || t.ask.waiting}</p>
                </li>
              ))}
            </ol>
            <form className="nh3d-agent-ask" onSubmit={event => { event.preventDefault(); void ask(); }}>
              <textarea ref={askInput} rows={2} value={draft} placeholder={t.ask.placeholder}
                onChange={event => setDraft(event.target.value)}
                onKeyDown={event => {
                  event.stopPropagation();
                  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void ask(); }
                }} />
              <div className="nh3d-agent-actions">
                <button type="submit" disabled={!draft.trim() || !!pending}>{t.ask.send}</button>
                <button type="button" disabled={!chat.length || !!pending} onClick={() => setChat([])}>{t.ask.clear}</button>
              </div>
            </form>
          </section>
        )}

        {tab === "settings" && (
          <section className="nh3d-agent-body">
            <label className="nh3d-agent-field">
              <span>{t.settings.apiKey}</span>
              <input type="password" autoComplete="off" value={keyDraft} placeholder={apiKey ? "••••••••" : "sk-ant-…"}
                onChange={event => setKeyDraft(event.target.value)} onKeyDown={event => event.stopPropagation()} />
            </label>
            <p className="nh3d-agent-hint">{t.settings.apiKeyHint}</p>
            <div className="nh3d-agent-actions">
              <button type="button" disabled={!keyDraft.trim()} onClick={() => {
                const key = keyDraft.trim();
                localStorage.setItem(API_KEY_KEY, key);
                setApiKey(key);
                setKeyDraft("");
                setNotice(null);
                setSavedNotice(true);
              }}>{t.settings.save}</button>
              {apiKey && <button type="button" onClick={() => { localStorage.removeItem(API_KEY_KEY); setApiKey(""); }}>{t.settings.forgetKey}</button>}
              {savedNotice && <span role="status">{t.settings.saved}</span>}
            </div>
            <label className="nh3d-agent-field">
              <span>{t.settings.model}</span>
              <select value={settings.model} onChange={event => updateSettings({ model: event.target.value as AgentModel })}>
                {agentModels.map(model => <option key={model} value={model}>{t.settings.models[model]}</option>)}
              </select>
            </label>
            <label className="nh3d-agent-field">
              <span>{t.settings.effort}</span>
              <select value={settings.effort} onChange={event => updateSettings({ effort: event.target.value as AgentEffort })}>
                {agentEfforts.map(effort => <option key={effort} value={effort}>{t.settings.efforts[effort]}</option>)}
              </select>
            </label>
            <label className="nh3d-agent-field">
              <span>{t.settings.budget}</span>
              <input type="number" min={0.5} step={0.5} value={settings.budgetUsd} onKeyDown={event => event.stopPropagation()}
                onChange={event => { const value = Number(event.target.value); if (value > 0) updateSettings({ budgetUsd: value }); }} />
            </label>
          </section>
        )}
      </aside>
    </>,
    document.body,
  );
}
