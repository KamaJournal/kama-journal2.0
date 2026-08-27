import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";
import {
  Plus, X, Trash2, Pencil, Image as ImageIcon, Upload, TrendingUp,
  TrendingDown, Minus, ChevronDown, Search, Camera,
} from "lucide-react";

// ---------------------------------------------------------------------------
// KĀMA JOURNAL — design tokens
// ---------------------------------------------------------------------------
const C = {
  bg: "#080B12",
  bgPanel: "#0F1420",
  bgPanel2: "#131928",
  bgInset: "#0A0E17",
  line: "#1E2536",
  lineSoft: "#161C2C",
  gold: "#D4AF37",
  goldSoft: "#8A7530",
  blue: "#3B82F6",
  blueSoft: "#1E3A66",
  text: "#E9ECF3",
  textDim: "#8B93A7",
  textFaint: "#4C5468",
  win: "#3FBF7F",
  loss: "#E15554",
  be: "#8B93A7",
};

const MOODS = [
  { id: "tilted", label: "Tilted", emoji: "\u{1F624}" },
  { id: "anxious", label: "Anxious", emoji: "\u{1F62C}" },
  { id: "neutral", label: "Neutral", emoji: "\u{1F610}" },
  { id: "calm", label: "Calm", emoji: "\u{1F642}" },
  { id: "locked_in", label: "Locked in", emoji: "\u{1F3AF}" },
];

const OUTCOMES = [
  { id: "open", label: "Open" },
  { id: "win", label: "Win" },
  { id: "loss", label: "Loss" },
  { id: "be", label: "Breakeven" },
];

const emptyForm = () => ({
  id: null,
  type: "backtest",
  date: new Date().toISOString().slice(0, 10),
  pair: "",
  direction: "long",
  entry: "",
  sl: "",
  tp: "",
  riskPct: "1",
  outcome: "open",
  resultR: "",
  setup: "",
  mood: "neutral",
  notes: "",
  screenshotDraft: null, // { dataUrl } held in memory until save
  hasScreenshot: false,
});

function computeRR(entry, sl, tp, direction) {
  const e = parseFloat(entry), s = parseFloat(sl), t = parseFloat(tp);
  if (!isFinite(e) || !isFinite(s) || !isFinite(t)) return null;
  const risk = direction === "long" ? e - s : s - e;
  const reward = direction === "long" ? t - e : e - t;
  if (risk <= 0) return null;
  return reward / risk;
}

function fmtR(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "\u2014";
  const v = Math.round(n * 100) / 100;
  return (v > 0 ? "+" : "") + v.toFixed(2) + "R";
}

function uid() {
  return "t_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

// ---------------------------------------------------------------------------

export default function KamaJournal() {
  const [ready, setReady] = useState(false);
  const [trades, setTrades] = useState([]);
  const [tab, setTab] = useState("all"); // all | live | backtest
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [setupFilter, setSetupFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [screenshots, setScreenshots] = useState({}); // id -> dataUrl (lazy loaded)
  const [viewingShot, setViewingShot] = useState(null); // trade id
  const [confirmDelete, setConfirmDelete] = useState(null);
  const fileInputRef = useRef(null);

  // ---- load ----
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("kj-trades", false);
        setTrades(r ? JSON.parse(r.value) : []);
      } catch (e) {
        setTrades([]);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const persist = useCallback(async (next) => {
    setTrades(next);
    try {
      await window.storage.set("kj-trades", JSON.stringify(next), false);
    } catch (e) {
      console.error("save failed", e);
    }
  }, []);

  async function loadScreenshot(id) {
    if (screenshots[id]) return;
    try {
      const r = await window.storage.get("kj-shot:" + id, false);
      if (r) setScreenshots((s) => ({ ...s, [id]: r.value }));
    } catch (e) {
      // no screenshot stored
    }
  }

  // ---- derived ----
  const setups = useMemo(() => {
    const s = new Set(trades.map((t) => t.setup).filter(Boolean));
    return Array.from(s);
  }, [trades]);

  const filtered = useMemo(() => {
    return trades
      .filter((t) => (tab === "all" ? true : t.type === tab))
      .filter((t) => (setupFilter === "all" ? true : t.setup === setupFilter))
      .filter((t) => {
        if (!query.trim()) return true;
        const q = query.toLowerCase();
        return (
          (t.pair || "").toLowerCase().includes(q) ||
          (t.setup || "").toLowerCase().includes(q) ||
          (t.notes || "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [trades, tab, setupFilter, query]);

  const stats = useMemo(() => {
    const closed = filtered.filter((t) => t.outcome !== "open" && t.resultR !== "" && t.resultR !== null && t.resultR !== undefined);
    const wins = closed.filter((t) => t.outcome === "win");
    const losses = closed.filter((t) => t.outcome === "loss");
    const rVals = closed.map((t) => parseFloat(t.resultR)).filter((n) => isFinite(n));
    const totalR = rVals.reduce((a, b) => a + b, 0);
    const expectancy = rVals.length ? totalR / rVals.length : 0;
    const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;
    const rrVals = filtered.map((t) => computeRR(t.entry, t.sl, t.tp, t.direction)).filter((n) => n !== null);
    const avgRR = rrVals.length ? rrVals.reduce((a, b) => a + b, 0) / rrVals.length : 0;
    return {
      count: filtered.length,
      closedCount: closed.length,
      winRate,
      expectancy,
      totalR,
      avgRR,
      wins: wins.length,
      losses: losses.length,
      be: closed.length - wins.length - losses.length,
    };
  }, [filtered]);

  const equityCurve = useMemo(() => {
    const closed = [...filtered]
      .filter((t) => t.outcome !== "open" && t.resultR !== "" && t.resultR !== null && t.resultR !== undefined)
      .sort((a, b) => (a.date > b.date ? 1 : -1));
    let cum = 0;
    return closed.map((t, i) => {
      cum += parseFloat(t.resultR) || 0;
      return { idx: i + 1, r: Math.round(cum * 100) / 100, date: t.date, pair: t.pair };
    });
  }, [filtered]);

  const moodBreakdown = useMemo(() => {
    const map = {};
    MOODS.forEach((m) => (map[m.id] = { mood: m.label, emoji: m.emoji, sumR: 0, n: 0 }));
    filtered.forEach((t) => {
      if (t.outcome === "open") return;
      const r = parseFloat(t.resultR);
      if (!isFinite(r)) return;
      if (!map[t.mood]) return;
      map[t.mood].sumR += r;
      map[t.mood].n += 1;
    });
    return Object.values(map)
      .filter((m) => m.n > 0)
      .map((m) => ({ ...m, avgR: Math.round((m.sumR / m.n) * 100) / 100 }));
  }, [filtered]);

  // ---- form handling ----
  function openNewForm(type) {
    setForm({ ...emptyForm(), type: type === "all" ? "backtest" : type });
    setShowForm(true);
  }

  function openEditForm(t) {
    setForm({ ...t, screenshotDraft: null });
    setShowForm(true);
    if (t.hasScreenshot) loadScreenshot(t.id);
  }

  function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setForm((f) => ({ ...f, screenshotDraft: reader.result }));
    };
    reader.readAsDataURL(file);
  }

  async function saveTrade() {
    if (!form.pair.trim()) return;
    setSaving(true);
    const id = form.id || uid();
    const rr = computeRR(form.entry, form.sl, form.tp, form.direction);
    const record = {
      id,
      type: form.type,
      date: form.date,
      pair: form.pair.trim().toUpperCase(),
      direction: form.direction,
      entry: form.entry,
      sl: form.sl,
      tp: form.tp,
      riskPct: form.riskPct,
      rr,
      outcome: form.outcome,
      resultR: form.resultR === "" ? "" : parseFloat(form.resultR),
      setup: form.setup.trim(),
      mood: form.mood,
      notes: form.notes,
      hasScreenshot: form.hasScreenshot || !!form.screenshotDraft,
      createdAt: form.createdAt || Date.now(),
    };

    let next;
    if (form.id) {
      next = trades.map((t) => (t.id === form.id ? record : t));
    } else {
      next = [record, ...trades];
    }
    await persist(next);

    if (form.screenshotDraft) {
      try {
        await window.storage.set("kj-shot:" + id, form.screenshotDraft, false);
        setScreenshots((s) => ({ ...s, [id]: form.screenshotDraft }));
      } catch (e) {
        console.error("screenshot save failed", e);
      }
    }

    setSaving(false);
    setShowForm(false);
    setForm(emptyForm());
  }

  async function deleteTrade(id) {
    const next = trades.filter((t) => t.id !== id);
    await persist(next);
    try {
      await window.storage.delete("kj-shot:" + id, false);
    } catch (e) {}
    setConfirmDelete(null);
  }

  const liveRR = computeRR(form.entry, form.sl, form.tp, form.direction);

  if (!ready) {
    return (
      <div style={{ background: C.bg, minHeight: 420, display: "flex", alignItems: "center", justifyContent: "center", color: C.textDim, fontFamily: "Inter, sans-serif" }}>
        Loading journal\u2026
      </div>
    );
  }

  return (
    <div className="kj-root" style={{ background: C.bg, color: C.text, minHeight: 600, fontFamily: "'Inter', sans-serif", position: "relative" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        .kj-root * { box-sizing: border-box; }
        .kj-display { font-family: 'Space Grotesk', sans-serif; }
        .kj-mono { font-family: 'JetBrains Mono', monospace; }
        .kj-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
        .kj-scroll::-webkit-scrollbar-thumb { background: ${C.line}; border-radius: 4px; }
        .kj-btn { transition: all 0.18s ease; cursor: pointer; }
        .kj-btn:hover { transform: translateY(-1px); }
        .kj-row { transition: background 0.15s ease; }
        .kj-row:hover { background: ${C.bgPanel2}; }
        .kj-fade-in { animation: kjFade 0.3s ease; }
        @keyframes kjFade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        .kj-input { background: ${C.bgInset}; border: 1px solid ${C.line}; color: ${C.text}; border-radius: 8px; padding: 9px 11px; font-size: 13.5px; font-family: 'Inter', sans-serif; outline: none; width: 100%; }
        .kj-input:focus { border-color: ${C.gold}; }
        .kj-label { font-size: 11px; color: ${C.textDim}; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px; display: block; font-weight: 600; }
        .kj-seg { display: flex; background: ${C.bgInset}; border: 1px solid ${C.line}; border-radius: 8px; padding: 3px; gap: 2px; }
        .kj-seg-btn { flex: 1; text-align: center; padding: 7px 10px; border-radius: 6px; font-size: 12.5px; font-weight: 600; cursor: pointer; color: ${C.textDim}; transition: all 0.18s ease; }
        .kj-seg-btn.active { background: ${C.gold}; color: #14110A; }
      `}</style>

      {/* Header */}
      <div style={{ borderBottom: `1px solid ${C.line}`, padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="kj-display" style={{ fontSize: 21, fontWeight: 700, letterSpacing: "0.01em", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: C.gold }}>K\u0100MA</span>
            <span style={{ color: C.textDim, fontWeight: 500 }}>Journal</span>
          </div>
          <div style={{ fontSize: 12, color: C.textFaint, marginTop: 2 }}>Backtested and live trade tracking</div>
        </div>
        <button
          onClick={() => openNewForm(tab)}
          className="kj-btn"
          style={{ background: C.gold, color: "#14110A", border: "none", borderRadius: 8, padding: "10px 16px", fontSize: 13.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}
        >
          <Plus size={16} strokeWidth={2.5} /> New trade
        </button>
      </div>

      {/* Tabs */}
      <div style={{ padding: "16px 24px 0", display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div className="kj-seg" style={{ width: 260 }}>
          {["all", "live", "backtest"].map((t) => (
            <div key={t} className={"kj-seg-btn" + (tab === t ? " active" : "")} onClick={() => setTab(t)} style={{ textTransform: "capitalize" }}>
              {t}
            </div>
          ))}
        </div>
        <div style={{ position: "relative", flex: "1 1 200px", minWidth: 160 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: C.textFaint }} />
          <input className="kj-input" style={{ paddingLeft: 30 }} placeholder="Search pair, setup, notes\u2026" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select className="kj-input" style={{ width: 170 }} value={setupFilter} onChange={(e) => setSetupFilter(e.target.value)}>
          <option value="all">All setups</option>
          {setups.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, padding: "18px 24px" }}>
        <StatCard label="Trades" value={stats.count} mono />
        <StatCard label="Win rate" value={stats.closedCount ? stats.winRate.toFixed(0) + "%" : "\u2014"} mono accent={stats.winRate >= 50 ? C.win : C.loss} />
        <StatCard label="Expectancy" value={stats.closedCount ? fmtR(stats.expectancy) : "\u2014"} mono accent={stats.expectancy >= 0 ? C.win : C.loss} />
        <StatCard label="Total R" value={stats.closedCount ? fmtR(stats.totalR) : "\u2014"} mono accent={stats.totalR >= 0 ? C.win : C.loss} />
        <StatCard label="Avg planned RR" value={stats.avgRR ? stats.avgRR.toFixed(2) + "R" : "\u2014"} mono />
        <StatCard label="W / L / BE" value={`${stats.wins} / ${stats.losses} / ${stats.be}`} mono small />
      </div>

      {/* Equity curve */}
      {equityCurve.length > 1 && (
        <div style={{ margin: "0 24px 18px", background: C.bgPanel, border: `1px solid ${C.line}`, borderRadius: 12, padding: "16px 16px 6px" }}>
          <div style={{ fontSize: 12, color: C.textDim, fontWeight: 600, marginBottom: 6, letterSpacing: "0.03em" }}>EQUITY CURVE (R-MULTIPLE)</div>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={equityCurve} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="kjEquityFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.gold} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={C.gold} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={C.lineSoft} vertical={false} />
              <XAxis dataKey="idx" tick={{ fill: C.textFaint, fontSize: 10 }} axisLine={{ stroke: C.line }} tickLine={false} />
              <YAxis tick={{ fill: C.textFaint, fontSize: 10 }} axisLine={false} tickLine={false} width={34} />
              <ReferenceLine y={0} stroke={C.line} />
              <Tooltip
                contentStyle={{ background: C.bgInset, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: C.textDim }}
                formatter={(v) => [v + "R", "Cumulative"]}
                labelFormatter={(i, p) => (p && p[0] ? `${p[0].payload.pair} \u00b7 ${p[0].payload.date}` : "")}
              />
              <Area type="monotone" dataKey="r" stroke={C.gold} strokeWidth={2} fill="url(#kjEquityFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Mood breakdown */}
      {moodBreakdown.length > 1 && (
        <div style={{ margin: "0 24px 18px", background: C.bgPanel, border: `1px solid ${C.line}`, borderRadius: 12, padding: "16px 16px 6px" }}>
          <div style={{ fontSize: 12, color: C.textDim, fontWeight: 600, marginBottom: 6, letterSpacing: "0.03em" }}>AVG RESULT BY MOOD</div>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={moodBreakdown} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid stroke={C.lineSoft} vertical={false} />
              <XAxis dataKey="emoji" tick={{ fill: C.textDim, fontSize: 16 }} axisLine={{ stroke: C.line }} tickLine={false} />
              <YAxis tick={{ fill: C.textFaint, fontSize: 10 }} axisLine={false} tickLine={false} width={34} />
              <ReferenceLine y={0} stroke={C.line} />
              <Tooltip
                contentStyle={{ background: C.bgInset, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 12 }}
                formatter={(v, n, p) => [v + "R avg over " + p.payload.n, p.payload.mood]}
              />
              <Bar dataKey="avgR" radius={[4, 4, 4, 4]}>
                {moodBreakdown.map((m, i) => (
                  <Cell key={i} fill={m.avgR >= 0 ? C.win : C.loss} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Trade list */}
      <div style={{ margin: "0 24px 24px", background: C.bgPanel, border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
        {filtered.length === 0 ? (
          <div style={{ padding: "48px 20px", textAlign: "center", color: C.textFaint, fontSize: 13.5 }}>
            No trades yet. Log your first {tab === "live" ? "live" : tab === "backtest" ? "backtested" : ""} trade to start building your stats.
          </div>
        ) : (
          <div className="kj-scroll" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.line}` }}>
                  {["Date", "Type", "Pair", "Dir", "RR", "Result", "Setup", "Mood", "", ""].map((h, i) => (
                    <th key={i} style={{ textAlign: "left", padding: "10px 12px", color: C.textFaint, fontWeight: 600, fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => {
                  const rr = t.rr !== undefined && t.rr !== null ? t.rr : computeRR(t.entry, t.sl, t.tp, t.direction);
                  const mood = MOODS.find((m) => m.id === t.mood);
                  return (
                    <tr key={t.id} className="kj-row" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
                      <td className="kj-mono" style={{ padding: "10px 12px", color: C.textDim, whiteSpace: "nowrap" }}>{t.date}</td>
                      <td style={{ padding: "10px 12px" }}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 7px", borderRadius: 5, background: t.type === "live" ? C.blueSoft : "#2A2313", color: t.type === "live" ? C.blue : C.gold, textTransform: "uppercase" }}>
                          {t.type}
                        </span>
                      </td>
                      <td style={{ padding: "10px 12px", fontWeight: 600 }}>{t.pair}</td>
                      <td style={{ padding: "10px 12px" }}>
                        {t.direction === "long" ? <TrendingUp size={14} color={C.win} /> : <TrendingDown size={14} color={C.loss} />}
                      </td>
                      <td className="kj-mono" style={{ padding: "10px 12px", color: C.textDim }}>{rr !== null ? rr.toFixed(2) + "R" : "\u2014"}</td>
                      <td className="kj-mono" style={{ padding: "10px 12px", fontWeight: 700, color: t.outcome === "win" ? C.win : t.outcome === "loss" ? C.loss : t.outcome === "be" ? C.be : C.textFaint }}>
                        {t.outcome === "open" ? "Open" : fmtR(parseFloat(t.resultR))}
                      </td>
                      <td style={{ padding: "10px 12px", color: C.textDim, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.setup || "\u2014"}</td>
                      <td style={{ padding: "10px 12px", fontSize: 15 }}>{mood ? mood.emoji : ""}</td>
                      <td style={{ padding: "10px 12px" }}>
                        {t.hasScreenshot && (
                          <button className="kj-btn" onClick={() => { loadScreenshot(t.id); setViewingShot(t.id); }} style={{ background: "none", border: "none", cursor: "pointer", color: C.textDim, display: "flex" }}>
                            <ImageIcon size={15} />
                          </button>
                        )}
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button className="kj-btn" onClick={() => openEditForm(t)} style={{ background: "none", border: "none", cursor: "pointer", color: C.textFaint }}>
                            <Pencil size={14} />
                          </button>
                          <button className="kj-btn" onClick={() => setConfirmDelete(t.id)} style={{ background: "none", border: "none", cursor: "pointer", color: C.textFaint }}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---- New/Edit trade modal ---- */}
      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(4,6,10,0.72)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }} onClick={() => setShowForm(false)}>
          <div className="kj-fade-in kj-scroll" onClick={(e) => e.stopPropagation()} style={{ background: C.bgPanel, border: `1px solid ${C.line}`, borderRadius: 14, width: 560, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto" }}>
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.line}`, display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, background: C.bgPanel, zIndex: 2 }}>
              <div className="kj-display" style={{ fontSize: 16, fontWeight: 700 }}>{form.id ? "Edit trade" : "New trade"}</div>
              <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer" }}><X size={18} /></button>
            </div>

            <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="kj-seg">
                {["backtest", "live"].map((t) => (
                  <div key={t} className={"kj-seg-btn" + (form.type === t ? " active" : "")} onClick={() => setForm((f) => ({ ...f, type: t }))} style={{ textTransform: "capitalize" }}>{t}</div>
                ))}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label className="kj-label">Date</label>
                  <input type="date" className="kj-input" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
                </div>
                <div>
                  <label className="kj-label">Pair</label>
                  <input className="kj-input" placeholder="EURUSD" value={form.pair} onChange={(e) => setForm((f) => ({ ...f, pair: e.target.value }))} />
                </div>
              </div>

              <div>
                <label className="kj-label">Direction</label>
                <div className="kj-seg">
                  {["long", "short"].map((d) => (
                    <div key={d} className={"kj-seg-btn" + (form.direction === d ? " active" : "")} onClick={() => setForm((f) => ({ ...f, direction: d }))} style={{ textTransform: "capitalize" }}>{d}</div>
                  ))}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <div>
                  <label className="kj-label">Entry</label>
                  <input className="kj-input kj-mono" inputMode="decimal" value={form.entry} onChange={(e) => setForm((f) => ({ ...f, entry: e.target.value }))} />
                </div>
                <div>
                  <label className="kj-label">Stop loss</label>
                  <input className="kj-input kj-mono" inputMode="decimal" value={form.sl} onChange={(e) => setForm((f) => ({ ...f, sl: e.target.value }))} />
                </div>
                <div>
                  <label className="kj-label">Take profit</label>
                  <input className="kj-input kj-mono" inputMode="decimal" value={form.tp} onChange={(e) => setForm((f) => ({ ...f, tp: e.target.value }))} />
                </div>
              </div>

              <div style={{ background: C.bgInset, border: `1px solid ${C.line}`, borderRadius: 8, padding: "9px 12px", display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                <span style={{ color: C.textDim }}>Planned RR (auto)</span>
                <span className="kj-mono" style={{ color: liveRR !== null ? (liveRR >= 1 ? C.win : C.loss) : C.textFaint, fontWeight: 700 }}>
                  {liveRR !== null ? liveRR.toFixed(2) + "R" : "\u2014"}
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label className="kj-label">Risk % of account</label>
                  <input className="kj-input kj-mono" inputMode="decimal" value={form.riskPct} onChange={(e) => setForm((f) => ({ ...f, riskPct: e.target.value }))} />
                </div>
                <div>
                  <label className="kj-label">Setup / tag</label>
                  <input className="kj-input" placeholder="London liquidity sweep" value={form.setup} onChange={(e) => setForm((f) => ({ ...f, setup: e.target.value }))} />
                </div>
              </div>

              <div>
                <label className="kj-label">Outcome</label>
                <div className="kj-seg">
                  {OUTCOMES.map((o) => (
                    <div key={o.id} className={"kj-seg-btn" + (form.outcome === o.id ? " active" : "")} onClick={() => setForm((f) => ({ ...f, outcome: o.id }))}>{o.label}</div>
                  ))}
                </div>
              </div>

              {form.outcome !== "open" && (
                <div>
                  <label className="kj-label">Realized result (R-multiple)</label>
                  <input className="kj-input kj-mono" inputMode="decimal" placeholder={liveRR !== null ? liveRR.toFixed(2) : "e.g. 2.3 or -1"} value={form.resultR} onChange={(e) => setForm((f) => ({ ...f, resultR: e.target.value }))} />
                  <div style={{ fontSize: 11, color: C.textFaint, marginTop: 4 }}>Positive R for wins, negative for losses. Defaults to planned RR if you leave it blank for a win.</div>
                </div>
              )}

              <div>
                <label className="kj-label">Mood while taking the trade</label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {MOODS.map((m) => (
                    <div
                      key={m.id}
                      onClick={() => setForm((f) => ({ ...f, mood: m.id }))}
                      className="kj-btn"
                      style={{
                        border: `1px solid ${form.mood === m.id ? C.gold : C.line}`,
                        background: form.mood === m.id ? "#2A2313" : C.bgInset,
                        borderRadius: 8, padding: "7px 10px", fontSize: 12.5, display: "flex", alignItems: "center", gap: 6,
                        color: form.mood === m.id ? C.gold : C.textDim,
                      }}
                    >
                      <span style={{ fontSize: 15 }}>{m.emoji}</span> {m.label}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="kj-label">Notes</label>
                <textarea className="kj-input" rows={3} placeholder="Why you took it, what confirmed it, what you'd do differently\u2026" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>

              <div>
                <label className="kj-label">Screenshot</label>
                {form.screenshotDraft || (form.hasScreenshot && screenshots[form.id]) ? (
                  <div style={{ position: "relative" }}>
                    <img src={form.screenshotDraft || screenshots[form.id]} alt="chart screenshot" style={{ width: "100%", borderRadius: 8, border: `1px solid ${C.line}`, display: "block" }} />
                    <button
                      onClick={() => setForm((f) => ({ ...f, screenshotDraft: null, hasScreenshot: false }))}
                      className="kj-btn"
                      style={{ position: "absolute", top: 8, right: 8, background: "rgba(8,11,18,0.85)", border: `1px solid ${C.line}`, borderRadius: 6, color: C.text, padding: 5, cursor: "pointer" }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ) : (
                  <div
                    onClick={() => fileInputRef.current && fileInputRef.current.click()}
                    className="kj-btn"
                    style={{ border: `1.5px dashed ${C.line}`, borderRadius: 8, padding: "22px 12px", textAlign: "center", color: C.textFaint, cursor: "pointer" }}
                  >
                    <Upload size={18} style={{ marginBottom: 6 }} />
                    <div style={{ fontSize: 12.5 }}>Upload chart screenshot</div>
                    <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
                  </div>
                )}
              </div>
            </div>

            <div style={{ padding: "14px 20px", borderTop: `1px solid ${C.line}`, display: "flex", justifyContent: "flex-end", gap: 8, position: "sticky", bottom: 0, background: C.bgPanel }}>
              <button onClick={() => setShowForm(false)} className="kj-btn" style={{ background: "none", border: `1px solid ${C.line}`, color: C.textDim, borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 600 }}>Cancel</button>
              <button onClick={saveTrade} disabled={saving || !form.pair.trim()} className="kj-btn" style={{ background: C.gold, border: "none", color: "#14110A", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 700, opacity: !form.pair.trim() ? 0.5 : 1 }}>
                {saving ? "Saving\u2026" : "Save trade"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Screenshot viewer ---- */}
      {viewingShot && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(4,6,10,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 20 }} onClick={() => setViewingShot(null)}>
          {screenshots[viewingShot] ? (
            <img src={screenshots[viewingShot]} alt="trade screenshot" style={{ maxWidth: "100%", maxHeight: "90vh", borderRadius: 10, border: `1px solid ${C.line}` }} onClick={(e) => e.stopPropagation()} />
          ) : (
            <div style={{ color: C.textDim }}>Loading\u2026</div>
          )}
        </div>
      )}

      {/* ---- Delete confirm ---- */}
      {confirmDelete && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(4,6,10,0.72)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70 }} onClick={() => setConfirmDelete(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.bgPanel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 20, width: 300 }}>
            <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 14 }}>Delete this trade?</div>
            <div style={{ fontSize: 12.5, color: C.textDim, marginBottom: 16 }}>This removes it and its screenshot permanently.</div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setConfirmDelete(null)} style={{ background: "none", border: `1px solid ${C.line}`, color: C.textDim, borderRadius: 8, padding: "8px 14px", fontSize: 12.5, cursor: "pointer" }}>Cancel</button>
              <button onClick={() => deleteTrade(confirmDelete)} style={{ background: C.loss, border: "none", color: "#fff", borderRadius: 8, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, mono, accent, small }) {
  return (
    <div style={{ background: C.bgPanel, border: `1px solid ${C.line}`, borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ fontSize: 10.5, color: C.textFaint, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4, fontWeight: 600 }}>{label}</div>
      <div className={mono ? "kj-mono" : ""} style={{ fontSize: small ? 15 : 19, fontWeight: 700, color: accent || C.text }}>{value}</div>
    </div>
  );
}
