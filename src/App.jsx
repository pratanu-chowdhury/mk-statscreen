import React, { useEffect, useMemo, useState } from "react";
import { learn, score, metrics, standardizer } from "./model.js";
import { readFiles, extractAll } from "./extract.js";
import {
  mode as storageMode,
  listScreenings,
  getScreening,
  saveScreening,
  deleteScreening,
} from "./store.js";

// ---- seed state -------------------------------------------------------------
const uid = () => Math.random().toString(36).slice(2, 9);

const SEED_PREDICTORS = [
  { id: uid(), name: "Years of experience", short: "Exp", kind: "number",
    fallback: 0, config: { pattern: "(\\d+(?:\\.\\d+)?)\\s*\\+?\\s*years?" } },
  { id: uid(), name: "Python / data stack", short: "Py", kind: "keyword",
    fallback: 0, config: { terms: "python, pandas, numpy, sql", mode: "count" } },
  { id: uid(), name: "Cloud platform", short: "Cloud", kind: "boolean",
    fallback: 0, config: { terms: "aws, azure, gcp, kubernetes" } },
  { id: uid(), name: "Education level", short: "Edu", kind: "level",
    fallback: 1, config: { levels: "phd=4, master=3, mba=3, bachelor=2" } },
];

const SEED_ROWS = [
  { id: uid(), values: [6, 5, 1, 3], y: 1 },
  { id: uid(), values: [2, 1, 0, 2], y: 0 },
  { id: uid(), values: [8, 7, 1, 3], y: 1 },
  { id: uid(), values: [1, 0, 0, 1], y: 0 },
  { id: uid(), values: [4, 3, 1, 2], y: 1 },
  { id: uid(), values: [3, 1, 0, 2], y: 0 },
  { id: uid(), values: [7, 6, 1, 4], y: 1 },
  { id: uid(), values: [2, 2, 0, 1], y: 0 },
];

const defaultState = () => ({
  jd: { title: "Data Analyst", text: "" },
  predictors: SEED_PREDICTORS,
  rows: SEED_ROWS,
  fitMode: "learn", // "learn" | "manual"
  manual: { bias: 0, weights: [1, 1, 0.6, 0.8] },
  lambda: 1.0,
  threshold: 0.5,
  uploaded: [],
});

const TABS = ["Role", "Predictors", "Training", "Model", "Candidates", "Saved"];

export default function App() {
  const [s, setS] = useState(defaultState);
  const [tab, setTab] = useState("Role");
  const [currentId, setCurrentId] = useState(null);
  const [screenName, setScreenName] = useState("");
  const [saved, setSaved] = useState([]);
  const [busy, setBusy] = useState("");

  const set = (patch) => setS((prev) => ({ ...prev, ...patch }));

  // keep manual weights array aligned to predictor count
  useEffect(() => {
    setS((prev) => {
      const k = prev.predictors.length;
      const w = prev.manual.weights.slice(0, k);
      while (w.length < k) w.push(0);
      return { ...prev, manual: { ...prev.manual, weights: w } };
    });
  }, [s.predictors.length]);

  const refreshSaved = () => listScreenings().then(setSaved).catch(() => setSaved([]));
  useEffect(() => { refreshSaved(); }, []);

  // ---- model ----------------------------------------------------------------
  const X = s.rows.map((r) => r.predictors ?? r.values);
  const y = s.rows.map((r) => r.y);
  const hasBothClasses = y.includes(0) && y.includes(1);
  const canLearn = s.rows.length >= 2 && hasBothClasses;
  const effectiveMode = s.fitMode === "learn" && canLearn ? "learn" : "manual";

  const model = useMemo(() => {
    if (effectiveMode === "learn") return learn(X, y, { lambda: s.lambda });
    // manual: standardize using whatever data we have so weights are comparable
    const basis = X.length ? X : s.uploaded.map((u) => u.values);
    const stats = basis.length
      ? standardizer(basis)
      : { mean: s.predictors.map(() => 0), std: s.predictors.map(() => 1) };
    return { bias: s.manual.bias, beta: s.manual.weights.slice(), stats };
  }, [effectiveMode, JSON.stringify(s.rows), JSON.stringify(s.manual), s.lambda,
      s.predictors.length, JSON.stringify(s.uploaded.map((u) => u.values))]);

  const trainMetrics = useMemo(
    () => metrics(model, X, y, s.threshold),
    [model, JSON.stringify(s.rows), s.threshold]
  );

  const scored = useMemo(() => {
    return s.uploaded
      .map((c) => ({ ...c, ...score(model, c.values) }))
      .sort((a, b) => b.prob - a.prob);
  }, [model, JSON.stringify(s.uploaded)]);

  // ---- predictor editing ----------------------------------------------------
  const updatePredictor = (id, patch) =>
    set({ predictors: s.predictors.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const updateConfig = (id, patch) =>
    set({
      predictors: s.predictors.map((p) =>
        p.id === id ? { ...p, config: { ...p.config, ...patch } } : p
      ),
    });
  const addPredictor = () => {
    const np = { id: uid(), name: "New predictor", short: "New", kind: "keyword",
      fallback: 0, config: { terms: "", mode: "count" } };
    set({
      predictors: [...s.predictors, np],
      rows: s.rows.map((r) => ({ ...r, values: [...(r.predictors ?? r.values), 0] })),
      uploaded: s.uploaded.map((u) => ({ ...u, values: [...u.values, np.fallback] })),
    });
  };
  const removePredictor = (idx) => {
    set({
      predictors: s.predictors.filter((_, i) => i !== idx),
      rows: s.rows.map((r) => ({
        ...r,
        values: (r.predictors ?? r.values).filter((_, i) => i !== idx),
      })),
      uploaded: s.uploaded.map((u) => ({ ...u, values: u.values.filter((_, i) => i !== idx) })),
      manual: { ...s.manual, weights: s.manual.weights.filter((_, i) => i !== idx) },
    });
  };

  // ---- training rows --------------------------------------------------------
  const addRow = () =>
    set({ rows: [...s.rows, { id: uid(), values: s.predictors.map(() => 0), y: 0 }] });
  const setCell = (rid, idx, v) =>
    set({
      rows: s.rows.map((r) =>
        r.id === rid
          ? { ...r, values: (r.predictors ?? r.values).map((c, i) => (i === idx ? v : c)) }
          : r
      ),
    });
  const setLabel = (rid, v) =>
    set({ rows: s.rows.map((r) => (r.id === rid ? { ...r, y: v } : r)) });
  const removeRow = (rid) => set({ rows: s.rows.filter((r) => r.id !== rid) });

  // ---- candidate upload -----------------------------------------------------
  const onFiles = async (files) => {
    if (!files?.length) return;
    setBusy("Reading resumes…");
    try {
      const docs = await readFiles(files);
      const next = docs.map((d) => ({
        name: d.name,
        text: d.text,
        error: d.error,
        values: extractAll(s.predictors, d.text),
      }));
      set({ uploaded: [...s.uploaded, ...next] });
      setTab("Candidates");
    } finally {
      setBusy("");
    }
  };
  const setCandValue = (i, idx, v) =>
    set({
      uploaded: s.uploaded.map((u, j) =>
        j === i ? { ...u, values: u.values.map((c, k) => (k === idx ? v : c)) } : u
      ),
    });
  const removeCand = (i) => set({ uploaded: s.uploaded.filter((_, j) => j !== i) });
  const clearCands = () => set({ uploaded: [] });

  // ---- save / load ----------------------------------------------------------
  const doSave = async () => {
    const name = (screenName || s.jd.title || "Untitled screening").trim();
    setBusy("Saving…");
    try {
      const { id } = await saveScreening({ id: currentId, name, data: s });
      setCurrentId(id);
      setScreenName(name);
      await refreshSaved();
    } finally {
      setBusy("");
    }
  };
  const doLoad = async (id) => {
    setBusy("Loading…");
    try {
      const rec = await getScreening(id);
      if (rec?.data) {
        set(rec.data);
        setCurrentId(rec.id);
        setScreenName(rec.name);
        setTab("Candidates");
      }
    } finally {
      setBusy("");
    }
  };
  const doDelete = async (id) => {
    await deleteScreening(id);
    if (String(id) === String(currentId)) setCurrentId(null);
    refreshSaved();
  };

  const exportCsv = () => {
    const head = ["rank", "candidate", "probability", "shortlisted", ...s.predictors.map((p) => p.short)];
    const lines = scored.map((c, i) =>
      [i + 1, csv(c.name), c.prob.toFixed(4), c.prob >= s.threshold ? "yes" : "no", ...c.values]
        .join(",")
    );
    download(`${(s.jd.title || "shortlist").replace(/\s+/g, "-")}.csv`, [head.join(","), ...lines].join("\n"));
  };

  // ---------------------------------------------------------------------------
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mk">MK</span>
          <div>
            <div className="brand-title">StatScreen</div>
            <div className="brand-sub">Explainable resume screening · MK Recruitments</div>
          </div>
        </div>
        <div className="storage-pill" title="Where saved screenings live">
          ● {storageMode}
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t} className={t === tab ? "tab on" : "tab"} onClick={() => setTab(t)}>
            {t}
            {t === "Candidates" && s.uploaded.length ? <em>{s.uploaded.length}</em> : null}
          </button>
        ))}
      </nav>

      {busy && <div className="busy">{busy}</div>}

      <main className="content">
        {tab === "Role" && (
          <section className="card">
            <h2>Role</h2>
            <label className="field">
              <span>Job title</span>
              <input
                value={s.jd.title}
                onChange={(e) => set({ jd: { ...s.jd, title: e.target.value } })}
                placeholder="e.g. Senior Data Analyst"
              />
            </label>
            <label className="field">
              <span>Job description (reference only)</span>
              <textarea
                rows={8}
                value={s.jd.text}
                onChange={(e) => set({ jd: { ...s.jd, text: e.target.value } })}
                placeholder="Paste the JD. It documents the role; the predictors below are what actually score candidates."
              />
            </label>
            <p className="hint">
              Define what matters in <b>Predictors</b>, teach the model from past hires in{" "}
              <b>Training</b> (or set weights by hand in <b>Model</b>), then score resumes in{" "}
              <b>Candidates</b>.
            </p>
          </section>
        )}

        {tab === "Predictors" && (
          <section className="card">
            <div className="card-head">
              <h2>Predictors</h2>
              <button className="btn" onClick={addPredictor}>+ Add predictor</button>
            </div>
            <p className="hint">
              Each predictor reads resume text and produces one number. Extraction is keyword/regex,
              not full NLP — you can override any value per candidate.
            </p>
            <div className="predictors">
              {s.predictors.map((p, idx) => (
                <div className="predictor" key={p.id}>
                  <div className="predictor-row">
                    <input className="grow" value={p.name}
                      onChange={(e) => updatePredictor(p.id, { name: e.target.value })} />
                    <input className="short" value={p.short} title="short label"
                      onChange={(e) => updatePredictor(p.id, { short: e.target.value })} />
                    <select value={p.kind} onChange={(e) => updatePredictor(p.id, { kind: e.target.value })}>
                      <option value="number">number</option>
                      <option value="keyword">keyword</option>
                      <option value="boolean">boolean</option>
                      <option value="level">level</option>
                    </select>
                    <button className="btn ghost" onClick={() => removePredictor(idx)}>✕</button>
                  </div>
                  <div className="predictor-cfg">
                    {p.kind === "number" && (
                      <label className="field inline">
                        <span>regex (1st capture = value)</span>
                        <input value={p.config.pattern || ""} className="mono"
                          onChange={(e) => updateConfig(p.id, { pattern: e.target.value })} />
                      </label>
                    )}
                    {(p.kind === "keyword" || p.kind === "boolean") && (
                      <label className="field inline">
                        <span>terms (comma-separated)</span>
                        <input value={p.config.terms || ""}
                          onChange={(e) => updateConfig(p.id, { terms: e.target.value })} />
                      </label>
                    )}
                    {p.kind === "keyword" && (
                      <label className="field inline narrow">
                        <span>mode</span>
                        <select value={p.config.mode || "count"}
                          onChange={(e) => updateConfig(p.id, { mode: e.target.value })}>
                          <option value="count">count</option>
                          <option value="binary">binary</option>
                        </select>
                      </label>
                    )}
                    {p.kind === "level" && (
                      <label className="field inline">
                        <span>levels (term=score, …)</span>
                        <input value={p.config.levels || ""} className="mono"
                          onChange={(e) => updateConfig(p.id, { levels: e.target.value })} />
                      </label>
                    )}
                    <label className="field inline narrow">
                      <span>fallback</span>
                      <input type="number" value={p.fallback}
                        onChange={(e) => updatePredictor(p.id, { fallback: num(e.target.value) })} />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === "Training" && (
          <section className="card">
            <div className="card-head">
              <h2>Training data</h2>
              <button className="btn" onClick={addRow}>+ Add row</button>
            </div>
            <p className="hint">
              Past examples: predictor values plus whether they were a good hire. The model learns
              weights from these. Need at least one of each outcome.
            </p>
            <div className="table-wrap">
              <table className="grid">
                <thead>
                  <tr>
                    {s.predictors.map((p) => <th key={p.id}>{p.short}</th>)}
                    <th>Hired?</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {s.rows.map((r) => {
                    const vals = r.predictors ?? r.values;
                    return (
                      <tr key={r.id}>
                        {vals.map((v, i) => (
                          <td key={i}>
                            <input type="number" value={v}
                              onChange={(e) => setCell(r.id, i, num(e.target.value))} />
                          </td>
                        ))}
                        <td className="center">
                          <button className={r.y ? "pill yes" : "pill no"}
                            onClick={() => setLabel(r.id, r.y ? 0 : 1)}>
                            {r.y ? "hired" : "no"}
                          </button>
                        </td>
                        <td><button className="btn ghost" onClick={() => removeRow(r.id)}>✕</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!hasBothClasses && (
              <p className="warn">Add at least one hired (1) and one not-hired (0) row to learn weights.</p>
            )}
          </section>
        )}

        {tab === "Model" && (
          <section className="card">
            <h2>Model</h2>
            <div className="seg">
              <button className={s.fitMode === "learn" ? "on" : ""} onClick={() => set({ fitMode: "learn" })}>
                Learn from data
              </button>
              <button className={s.fitMode === "manual" ? "on" : ""} onClick={() => set({ fitMode: "manual" })}>
                Set weights by hand
              </button>
            </div>

            {s.fitMode === "learn" && !canLearn && (
              <p className="warn">Not enough labelled data to learn — showing manual weights instead.</p>
            )}

            {s.fitMode === "learn" && canLearn && (
              <label className="field">
                <span>Ridge strength (λ = {s.lambda})</span>
                <input type="range" min="0" max="10" step="0.5" value={s.lambda}
                  onChange={(e) => set({ lambda: num(e.target.value) })} />
              </label>
            )}

            <div className="weights">
              <div className="weights-head">
                <span>Predictor</span><span>Weight (standardized)</span>
              </div>
              {s.predictors.map((p, i) => (
                <div className="weights-row" key={p.id}>
                  <span>{p.name}</span>
                  {effectiveMode === "manual" ? (
                    <input type="number" step="0.1" value={s.manual.weights[i] ?? 0}
                      onChange={(e) =>
                        set({ manual: { ...s.manual,
                          weights: s.manual.weights.map((w, j) => (j === i ? num(e.target.value) : w)) } })
                      } />
                  ) : (
                    <code className={model.beta[i] >= 0 ? "pos" : "neg"}>
                      {model.beta[i]?.toFixed(3)}
                    </code>
                  )}
                </div>
              ))}
              <div className="weights-row bias">
                <span>Bias (intercept)</span>
                {effectiveMode === "manual" ? (
                  <input type="number" step="0.1" value={s.manual.bias}
                    onChange={(e) => set({ manual: { ...s.manual, bias: num(e.target.value) } })} />
                ) : (
                  <code>{model.bias?.toFixed(3)}</code>
                )}
              </div>
            </div>

            <label className="field">
              <span>Shortlist threshold ({Math.round(s.threshold * 100)}%)</span>
              <input type="range" min="0.05" max="0.95" step="0.05" value={s.threshold}
                onChange={(e) => set({ threshold: num(e.target.value) })} />
            </label>

            <div className="metrics">
              <div><b>{trainMetrics.n}</b><span>training rows</span></div>
              <div><b>{trainMetrics.acc == null ? "—" : Math.round(trainMetrics.acc * 100) + "%"}</b><span>train accuracy</span></div>
              <div><b>{trainMetrics.auc == null ? "—" : trainMetrics.auc.toFixed(2)}</b><span>AUC</span></div>
            </div>
            <p className="hint">
              Decision support, not a verdict. A location- or name-style predictor can encode bias —
              review every shortlist before acting.
            </p>
          </section>
        )}

        {tab === "Candidates" && (
          <section className="card">
            <div className="card-head">
              <h2>Candidates</h2>
              {s.uploaded.length > 0 && (
                <div className="row-gap">
                  <button className="btn" onClick={exportCsv}>Export CSV</button>
                  <button className="btn ghost" onClick={clearCands}>Clear</button>
                </div>
              )}
            </div>

            <label
              className="drop"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); onFiles(e.dataTransfer.files); }}
            >
              <input type="file" multiple accept=".pdf,.txt,.zip" hidden
                onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
              <b>Drop resumes here</b>
              <span>PDF · ZIP · TXT — parsed in your browser, never uploaded</span>
            </label>

            {scored.length > 0 && (
              <div className="table-wrap">
                <table className="grid ranked">
                  <thead>
                    <tr>
                      <th>#</th><th>Candidate</th><th>Score</th>
                      {s.predictors.map((p) => <th key={p.id}>{p.short}</th>)}
                      <th>Top drivers</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {scored.map((c) => {
                      const i = s.uploaded.findIndex((u) => u === c || u.name === c.name && u.text === c.text);
                      const top = c.contributions
                        .map((v, j) => ({ v, name: s.predictors[j]?.short }))
                        .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
                        .slice(0, 2);
                      const ok = c.prob >= s.threshold;
                      return (
                        <tr key={c.name + i} className={ok ? "short" : ""}>
                          <td className="center">{ok ? "★" : ""}</td>
                          <td>
                            {c.name}
                            {c.error && <div className="err">parse error: {c.error}</div>}
                          </td>
                          <td className="center">
                            <span className={ok ? "score on" : "score"}>{Math.round(c.prob * 100)}%</span>
                          </td>
                          {c.values.map((v, j) => (
                            <td key={j}>
                              <input type="number" value={v}
                                onChange={(e) => setCandValue(i, j, num(e.target.value))} />
                            </td>
                          ))}
                          <td className="drivers">
                            {top.map((t, k) => (
                              <span key={k} className={t.v >= 0 ? "chip pos" : "chip neg"}>
                                {t.name} {t.v >= 0 ? "+" : ""}{t.v.toFixed(2)}
                              </span>
                            ))}
                          </td>
                          <td><button className="btn ghost" onClick={() => removeCand(i)}>✕</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {s.uploaded.length === 0 && <p className="hint">No candidates yet. Drop some resumes above.</p>}
          </section>
        )}

        {tab === "Saved" && (
          <section className="card">
            <h2>Saved screenings</h2>
            <p className="hint">Stored in <b>{storageMode}</b>. A screening is the whole setup: role, predictors, training, weights, threshold and candidate pool.</p>
            <div className="save-row">
              <input value={screenName} placeholder={s.jd.title || "Screening name"}
                onChange={(e) => setScreenName(e.target.value)} />
              <button className="btn primary" onClick={doSave}>
                {currentId ? "Update" : "Save"}
              </button>
              {currentId && (
                <button className="btn ghost" onClick={() => { setCurrentId(null); setScreenName(""); }}>
                  New
                </button>
              )}
            </div>
            <ul className="saved">
              {saved.length === 0 && <li className="muted">Nothing saved yet.</li>}
              {saved.map((rec) => (
                <li key={rec.id} className={String(rec.id) === String(currentId) ? "current" : ""}>
                  <div>
                    <b>{rec.name}</b>
                    <span className="muted"> · {fmt(rec.updated_at)}</span>
                  </div>
                  <div className="row-gap">
                    <button className="btn" onClick={() => doLoad(rec.id)}>Load</button>
                    <button className="btn ghost" onClick={() => doDelete(rec.id)}>Delete</button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}

// ---- small helpers ----------------------------------------------------------
function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}
function fmt(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}
function csv(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function download(name, text) {
  const blob = new Blob([text], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}
