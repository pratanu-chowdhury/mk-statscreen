import React, { useState, useMemo, useRef, useEffect } from "react";
import { storageMode, listScreenings, getScreening, saveScreening, deleteScreening } from "./store";

/* ===== logistic regression (IRLS + ridge) ===== */
const sigmoid = z => z >= 0 ? 1 / (1 + Math.exp(-z)) : (() => { const t = Math.exp(z); return t / (1 + t); })();
function solveLinear(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]]; const pv = M[c][c];
    for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / pv; if (f !== 0) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = Array(n).fill(0); for (let i = 0; i < n; i++) x[i] = M[i][n] / M[i][i]; return x;
}
function logreg(rows, preds, o = { ridge: .001, maxIter: 50, tol: 1e-8 }) {
  const k = preds.length + 1;
  if (!rows.length || !preds.length) return { beta: Array(k).fill(0), iterations: 0, converged: false, sep: false };
  const X = rows.map(r => [1, ...preds.map(p => Number(r.values[p.key] ?? 0))]); const y = rows.map(r => r.y); const n = rows.length;
  let beta = Array(k).fill(0), it2 = 0, conv = false, maxEta = 0;
  for (let it = 0; it < o.maxIter; it++) {
    it2 = it + 1; const p = Array(n), w = Array(n); maxEta = 0;
    for (let i = 0; i < n; i++) { let e = 0; for (let j = 0; j < k; j++) e += X[i][j] * beta[j]; maxEta = Math.max(maxEta, Math.abs(e)); const pi = sigmoid(e); p[i] = pi; w[i] = Math.max(pi * (1 - pi), 1e-9); }
    const g = Array(k).fill(0); for (let j = 0; j < k; j++) { let s = 0; for (let i = 0; i < n; i++) s += X[i][j] * (y[i] - p[i]); if (j > 0) s -= o.ridge * beta[j]; g[j] = s; }
    const H = Array.from({ length: k }, () => Array(k).fill(0));
    for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) { let s = 0; for (let i = 0; i < n; i++) s += X[i][a] * w[i] * X[i][b]; if (a === b && a > 0) s += o.ridge; H[a][b] = s; }
    const d = solveLinear(H, g); if (!d) break; let md = 0; for (let j = 0; j < k; j++) { beta[j] += d[j]; md = Math.max(md, Math.abs(d[j])); } if (md < o.tol) { conv = true; break; }
  }
  return { beta, iterations: it2, converged: conv, sep: maxEta > 25 };
}
const logit = (values, beta, preds) => { let z = beta[0]; for (let i = 0; i < preds.length; i++) z += beta[i + 1] * Number(values[preds[i].key] ?? 0); return z; };

/* ===== keyword extraction ===== */
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const kwMatch = (t, kw) => { const n = String(t).toLowerCase(), r = String(kw).trim().toLowerCase(); if (!r) return false; return new RegExp("(^|[^a-z0-9+#])" + esc(r) + "([^a-z0-9+#]|$)", "i").test(n); };
function captureNumber(t, kws) { const n = String(t).toLowerCase(); for (const kw of kws) { const e = esc(kw.trim().toLowerCase()); if (!e) continue; const a = n.match(new RegExp(e + "[^0-9]{0,18}?(\\d{1,3})", "i")); if (a) return parseInt(a[1], 10); const b = n.match(new RegExp("(\\d{1,3})[^0-9]{0,18}?" + e, "i")); if (b) return parseInt(b[1], 10); } return null; }
function extractOne(p, t) {
  if (!t || !t.trim()) return p.fallback;
  if (p.kind === "binary") return (p.keywords || []).some(k => kwMatch(t, k)) ? 1 : p.fallback;
  if (p.kind === "ordinal") { for (const tier of [...(p.tiers || [])].sort((a, b) => b.value - a.value)) if ((tier.keywords || []).some(k => kwMatch(t, k))) return tier.value; return p.fallback; }
  if (p.numberMode === "occurrences") return (p.keywords || []).filter(k => kwMatch(t, k)).length || p.fallback;
  const num = captureNumber(t, p.keywords || []); return num === null ? p.fallback : num;
}
const extractAll = (ps, t) => Object.fromEntries(ps.map(p => [p.key, extractOne(p, t)]));

/* ===== JD keyword suggestions (lexicon-based, deterministic) ===== */
const LEXICON = ["python", "r", "vba", "excel", "sql", "sas", "power bi", "tableau", "matlab", "c++", "java", "javascript", "machine learning", "statistics", "modelling", "modeling", "pricing", "reserving", "valuation",
  "gurugram", "gurgaon", "mumbai", "delhi", "noida", "bengaluru", "bangalore", "pune", "hyderabad", "chennai", "kolkata", "remote",
  "masters", "master's", "m.sc", "msc", "mba", "bachelor", "b.sc", "b.tech", "phd", "postgraduate", "graduate", "actuarial science", "statistics", "mathematics",
  "papers cleared", "papers passed", "exams cleared", "actuarial papers", "papers", "exams", "cm1", "cm2", "cs1", "cs2", "cb1", "cb2", "cp1", "ifoa", "iai", "actuarial", "fellow", "associate"];
function analyzeJD(text) { if (!text || !text.trim()) return []; const found = []; for (const term of LEXICON) if (kwMatch(text, term)) found.push(term.toLowerCase()); return [...new Set(found)]; }

/* ===== PDF / ZIP ===== */
if (typeof window !== "undefined" && window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
async function pdfToText(buf) { const pdf = await pdfjsLib.getDocument({ data: buf }).promise; let o = ""; for (let i = 1; i <= pdf.numPages; i++) { const pg = await pdf.getPage(i); const tc = await pg.getTextContent(); o += tc.items.map(x => x.str).join(" ") + "\n"; } return o; }
async function readTextFile(file) { const l = file.name.toLowerCase(); if (l.endsWith(".pdf")) return pdfToText(await file.arrayBuffer()); return file.text(); }
async function fileToCandidates(file) {
  const name = file.name, lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) { const text = await pdfToText(await file.arrayBuffer()); return [{ name: name.replace(/\.pdf$/i, ""), resume: text, source: name }]; }
  if (lower.endsWith(".zip")) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer()); const out = [];
    for (const e of Object.values(zip.files)) {
      if (e.dir) continue; const en = e.name.split("/").pop(), el = en.toLowerCase();
      if (el.endsWith(".pdf")) { try { out.push({ name: en.replace(/\.pdf$/i, ""), resume: await pdfToText(await e.async("arraybuffer")), source: `${name} \u203a ${en}` }); } catch (x) { out.push({ name: en, resume: "", source: `${name} \u203a ${en}`, error: "Could not read PDF" }); } }
      else if (el.endsWith(".txt")) { out.push({ name: en.replace(/\.txt$/i, ""), resume: await e.async("string"), source: `${name} \u203a ${en}` }); }
    }
    return out.length ? out : [{ name, resume: "", source: name, error: "No PDF/TXT inside ZIP" }];
  }
  if (lower.endsWith(".txt")) { return [{ name: name.replace(/\.txt$/i, ""), resume: await file.text(), source: name }]; }
  return [{ name, resume: "", source: name, error: "Unsupported (PDF/ZIP/TXT)" }];
}

/* ===== defaults ===== */
const genKey = () => "p" + Math.random().toString(36).slice(2, 8);
const DEFAULT_PREDICTORS = [
  { key: "p1", name: "Actuarial papers cleared", kind: "count", numberMode: "captureAfter", keywords: ["papers cleared", "papers passed", "actuarial papers", "exams cleared", "papers"], tiers: [], fallback: 0 },
  { key: "p2", name: "Located in Gurugram", kind: "binary", numberMode: "captureAfter", keywords: ["gurgaon", "gurugram"], tiers: [], fallback: 0 },
  { key: "p3", name: "Technical skills (R / Python / VBA)", kind: "binary", numberMode: "captureAfter", keywords: ["python", "vba", " r ", "r,", "r/", "excel"], tiers: [], fallback: 0 },
  { key: "p4", name: "Highest qualification", kind: "ordinal", numberMode: "captureAfter", keywords: [], fallback: 1, tiers: [{ label: "Masters", value: 2, keywords: ["masters", "master's", "m.sc", "msc", "m.stat", "mba", "postgraduate"] }, { label: "Bachelors", value: 1, keywords: ["bachelor", "b.sc", "bsc", "b.stat", "b.tech", "undergraduate"] }] }
];
const RAW = [[2, 0, 1, 2, 1], [0, 1, 1, 2, 0], [4, 1, 0, 2, 1], [3, 0, 0, 1, 0], [5, 0, 0, 1, 0], [1, 0, 1, 2, 0], [5, 0, 1, 2, 0], [2, 1, 0, 1, 1], [0, 1, 1, 2, 0], [0, 0, 0, 2, 0], [4, 0, 0, 2, 1], [5, 1, 1, 2, 1], [1, 1, 1, 1, 1], [1, 0, 0, 2, 0], [2, 0, 0, 1, 0]];
const DEFAULT_ROWS = RAW.map(r => ({ values: { p1: r[0], p2: r[1], p3: r[2], p4: r[3] }, y: r[4] }));
const DEFAULT_JD = `Entry-Level Actuary - General Insurance (Gurugram)
Support reserving and pricing models for motor and health lines.
Build and maintain models in R, Python and VBA / Excel.
Progress through actuarial papers (papers cleared considered).
Bachelors or Masters in Statistics, Mathematics or Actuarial Science.
Candidates based in Gurugram preferred.`;
const SAMPLE = [
  { name: "Vivaan Sharma", resume: "M.Sc Statistics. Papers cleared: 5. Based in Gurugram. Skills: R, Python, VBA, Excel, SQL." },
  { name: "Aarohi Mehta", resume: "Masters in Actuarial Science. 4 papers cleared. Location: Gurgaon. Python and Excel." },
  { name: "Kabir Nair", resume: "B.Sc Mathematics. Papers cleared 3. Lives in Noida. Knows R and VBA." },
  { name: "Diya Reddy", resume: "M.Sc Statistics. Cleared 4 papers. Resident of Gurugram. Strong in R, Python." },
  { name: "Arjun Iyer", resume: "Bachelors in Statistics. 2 papers cleared. Based in Mumbai. Excel and VBA." },
  { name: "Saanvi Gupta", resume: "Masters in Mathematics. Papers cleared: 5. Bengaluru." },
  { name: "Ishaan Bose", resume: "B.Sc Actuarial. Papers cleared 1. Gurgaon based. Python and R user." },
  { name: "Anaya Joshi", resume: "Masters in Actuarial Science. Papers cleared 2. Gurugram. R, Python, VBA, SQL." }
];
const fmt = (x, d = 2) => (Number.isFinite(x) ? x : 0).toFixed(d);
const pct = (x, d = 0) => `${(100 * x).toFixed(d)}%`;

/* ===== small editors ===== */
function KeywordEditor({ keywords, suggestions, onAdd, onRemove }) {
  const [v, setV] = useState("");
  const sug = suggestions.filter(s => !keywords.map(k => k.toLowerCase()).includes(s));
  return (
    <div>
      <div className="chips">
        {keywords.map((k, i) => (<span className="kw" key={i}>{k || "\u00a0"}<button onClick={() => onRemove(i)}>×</button></span>))}
        <input className="txt" style={{ width: 130 }} placeholder="add keyword…" value={v}
          onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && v.trim()) { onAdd(v.trim()); setV(""); } }} />
      </div>
      {sug.length > 0 && <div className="chips" style={{ marginTop: 7 }}>
        <span className="src">from JD:</span>
        {sug.slice(0, 12).map((s, i) => (<span className="sug" key={i} onClick={() => onAdd(s)}>+ {s}</span>))}
      </div>}
    </div>
  );
}
function PredictorCard({ p, idx, suggestions, upd, remove }) {
  const setKw = (kws) => upd({ keywords: kws });
  return (
    <div className="predcard">
      <div className="titlebar">
        <span className="idtag">X{idx + 1}</span>
        <input className="txt" style={{ flex: 1, fontWeight: 600 }} value={p.name} onChange={e => upd({ name: e.target.value })} />
        <select value={p.kind} onChange={e => upd({ kind: e.target.value })}>
          <option value="binary">binary (yes/no)</option>
          <option value="count">count (a number)</option>
          <option value="ordinal">ordinal (tiers)</option>
        </select>
        <button className="xbtn" title="remove predictor" onClick={remove}>×</button>
      </div>
      {p.kind === "count" && (
        <div className="field"><label>How to read the number</label>
          <select value={p.numberMode} onChange={e => upd({ numberMode: e.target.value })}>
            <option value="captureAfter">capture a number near a keyword</option>
            <option value="occurrences">count how many keywords appear</option>
          </select></div>
      )}
      {p.kind !== "ordinal" ? (
        <div className="field"><label>Keywords to detect</label>
          <KeywordEditor keywords={p.keywords || []} suggestions={suggestions}
            onAdd={w => setKw([...(p.keywords || []), w])} onRemove={i => setKw((p.keywords || []).filter((_, j) => j !== i))} />
        </div>
      ) : (
        <div className="field"><label>Tiers (higher value = stronger)</label>
          {(p.tiers || []).map((t, ti) => (
            <div key={ti} style={{ background: "rgba(255,255,255,.6)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 10px", marginBottom: 8 }}>
              <div className="row">
                <input className="txt" style={{ width: 130 }} value={t.label} onChange={e => upd({ tiers: p.tiers.map((x, j) => j === ti ? { ...x, label: e.target.value } : x) })} />
                <span className="src">value</span>
                <input className="txt num" style={{ width: 64 }} type="number" value={t.value} onChange={e => upd({ tiers: p.tiers.map((x, j) => j === ti ? { ...x, value: Number(e.target.value) } : x) })} />
                <button className="xbtn" style={{ width: 26, height: 26 }} onClick={() => upd({ tiers: p.tiers.filter((_, j) => j !== ti) })}>×</button>
              </div>
              <div style={{ marginTop: 7 }}>
                <KeywordEditor keywords={t.keywords || []} suggestions={suggestions}
                  onAdd={w => upd({ tiers: p.tiers.map((x, j) => j === ti ? { ...x, keywords: [...(x.keywords || []), w] } : x) })}
                  onRemove={i => upd({ tiers: p.tiers.map((x, j) => j === ti ? { ...x, keywords: x.keywords.filter((_, m) => m !== i) } : x) })} />
              </div>
            </div>
          ))}
          <button className="btn ghost sm" onClick={() => upd({ tiers: [...(p.tiers || []), { label: "Tier", value: (p.tiers?.length || 0) + 1, keywords: [] }] })}>+ tier</button>
        </div>
      )}
      <div className="field" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <label style={{ margin: 0 }}>Default when nothing matches</label>
        <input className="txt num" style={{ width: 70 }} type="number" value={p.fallback} onChange={e => upd({ fallback: Number(e.target.value) })} />
      </div>
    </div>
  );
}

/* ===== charts (pure css, no deps) ===== */
function WeightChart({ predictors, eff, fitBeta }) {
  if (!predictors.length) return null;
  const maxW = Math.max(...eff.slice(1).map(w => Math.abs(w)), 0.5);
  return (
    <div className="wchart">
      {predictors.map((p, i) => {
        const w = eff[i + 1] || 0; const learned = fitBeta[i + 1] ?? 0;
        const wp = 50 * Math.min(Math.abs(w) / maxW, 1); const tick = 50 + (learned < 0 ? -1 : 1) * 50 * Math.min(Math.abs(learned) / maxW, 1);
        return (
          <div className="wbar-row" key={p.key}>
            <div className="wbar-lab"><span className="id">X{i + 1}</span> {p.name}</div>
            <div className="wbar-track"><div className="wbar-axis"></div>
              <div className={"wbar-fill " + (w < 0 ? "neg" : "pos")} style={{ width: wp + "%" }}></div>
              <div className="wbar-tick" style={{ left: tick + "%" }} title={"learned " + fmt(learned)}></div></div>
            <div className="wbar-val num" style={{ color: w < 0 ? "var(--coral)" : "var(--primary-d)" }}>{w >= 0 ? "+" : ""}{fmt(w)}</div>
          </div>);
      })}
      <div className="legendline">
        <span><span className="swatch" style={{ background: "#1ba14a" }}></span>positive (helps)</span>
        <span><span className="swatch" style={{ background: "#103a82" }}></span>negative (hurts)</span>
        <span><span className="swatch" style={{ background: "var(--violet)", width: 3 }}></span>data-learned value</span>
      </div>
    </div>);
}
function Contrib({ c, predictors, eff }) {
  const parts = [{ label: "Base", name: "Baseline", v: eff[0] || 0 }, ...predictors.map((p, i) => ({ label: "X" + (i + 1), name: p.name, v: (eff[i + 1] || 0) * (c.values[p.key] ?? 0) }))];
  const maxV = Math.max(...parts.map(x => Math.abs(x.v)), 0.5);
  return (
    <div className="contrib">
      <div className="muted" style={{ marginBottom: 4 }}>Why <b>{c.name}</b> lands at {pct(c.prob, 1)} — each piece's push on the log-odds (sum = {fmt(c.z, 2)}):</div>
      {parts.map((pt, i) => {
        const wp = 50 * Math.min(Math.abs(pt.v) / maxV, 1); return (
          <div className="contrib-row" key={i}>
            <div className="contrib-lab" title={pt.name}>{pt.label}</div>
            <div className="contrib-track"><div className="ax"></div><div className={"contrib-fill " + (pt.v < 0 ? "neg" : "pos")} style={{ width: wp + "%" }}></div></div>
            <div className="contrib-val num">{pt.v >= 0 ? "+" : ""}{fmt(pt.v, 2)}</div>
          </div>);
      })}
    </div>);
}
function CandidateBars({ list, threshold, selKey, onSelect }) {
  if (!list.length) return <p className="muted" style={{ marginTop: 10 }}>Upload resumes (or use the samples below) to see the ranking.</p>;
  return (
    <div className="cbars">
      <div className="cbars-line" style={{ left: `calc(140px + (100% - 140px) * ${threshold})` }}><span>cutoff {pct(threshold)}</span></div>
      {list.map((c, i) => {
        const key = c.source + "|" + c.name; return (
          <div className={"cbar-row" + (selKey === key ? " sel" : "")} key={i} onClick={() => onSelect(selKey === key ? null : key)}>
            <div className="cbar-lab" title={c.name}>{c.name}</div>
            <div className="cbar-track"><div className={"cbar-fill " + (c.prob >= threshold ? "go" : "hold")} style={{ width: Math.max(2, 100 * c.prob) + "%" }}><span className="cbar-pct">{pct(c.prob, 0)}</span></div></div>
          </div>);
      })}
    </div>);
}

/* ================= APP ================= */
export default function App() {
  const [jd, setJd] = useState(DEFAULT_JD);
  const [predictors, setPredictors] = useState(DEFAULT_PREDICTORS);
  const [rows, setRows] = useState(DEFAULT_ROWS);
  const [manual, setManual] = useState({});
  const [threshold, setThreshold] = useState(0.5);
  const [uploaded, setUploaded] = useState([]);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const [over, setOver] = useState(false);
  const fileRef = useRef(null); const jdRef = useRef(null);

  /* persistence */
  const [mode, setMode] = useState("local");
  const [screenings, setScreenings] = useState([]);
  const [curId, setCurId] = useState(null);
  const [curName, setCurName] = useState("");
  const [saveMsg, setSaveMsg] = useState("");
  const refresh = async () => { try { setScreenings(await listScreenings()); } catch { setScreenings([]); } };
  useEffect(() => { storageMode().then(setMode); refresh(); }, []);
  const doSave = async () => {
    const data = { jd, predictors, rows, manual, threshold, uploaded };
    const r = await saveScreening(curName || "Untitled role", data, curId);
    if (r && r.id != null) setCurId(r.id);
    setSaveMsg("Saved \u2713"); setTimeout(() => setSaveMsg(""), 1600); refresh();
  };
  const doLoad = async (id) => {
    const s = await getScreening(id); if (!s) return; const d = s.data || {};
    setJd(d.jd ?? DEFAULT_JD); setPredictors(d.predictors ?? DEFAULT_PREDICTORS); setRows(d.rows ?? DEFAULT_ROWS);
    setManual(d.manual ?? {}); setThreshold(d.threshold ?? 0.5); setUploaded(d.uploaded ?? []);
    setCurId(s.id); setCurName(s.name); setSelected(null);
  };
  const doDelete = async () => { if (!curId) return; await deleteScreening(curId); setCurId(null); setCurName(""); refresh(); };

  const suggestions = useMemo(() => analyzeJD(jd), [jd]);
  const fit = useMemo(() => logreg(rows, predictors), [rows, predictors]);
  const eff = [manual.intercept ?? fit.beta[0], ...predictors.map((p, i) => manual[p.key] !== undefined ? manual[p.key] : (fit.beta[i + 1] ?? 0))];
  const anyManual = Object.keys(manual).length > 0;

  const candidates = useMemo(() => {
    const all = [...SAMPLE.map(c => ({ ...c, source: "sample" })), ...uploaded];
    return all.map(c => { const values = c.error ? {} : extractAll(predictors, c.resume); const z = c.error ? -Infinity : logit(values, eff, predictors); return { ...c, values, z, prob: c.error ? 0 : sigmoid(z) }; }).sort((a, b) => b.prob - a.prob);
  }, [uploaded, predictors, rows, manual]);
  const readable = candidates.filter(c => !c.error);
  const shortlisted = readable.filter(c => c.prob >= threshold).length;

  const updPred = (key, patch) => setPredictors(ps => ps.map(p => p.key === key ? { ...p, ...patch } : p));
  const addPred = () => { const k = genKey(); setPredictors(ps => [...ps, { key: k, name: "New predictor", kind: "binary", numberMode: "captureAfter", keywords: [], tiers: [], fallback: 0 }]); setRows(rs => rs.map(r => ({ ...r, values: { ...r.values, [k]: 0 } }))); };
  const removePred = (key) => { setPredictors(ps => ps.filter(p => p.key !== key)); setRows(rs => rs.map(r => { const v = { ...r.values }; delete v[key]; return { ...r, values: v }; })); setManual(m => { const n = { ...m }; delete n[key]; return n; }); };

  const setCell = (ri, key, val) => setRows(rs => rs.map((r, i) => i === ri ? { ...r, values: { ...r.values, [key]: Number(val) } } : r));
  const setY = (ri, val) => setRows(rs => rs.map((r, i) => i === ri ? { ...r, y: Number(val) ? 1 : 0 } : r));
  const addRow = () => setRows(rs => [...rs, { values: Object.fromEntries(predictors.map(p => [p.key, 0])), y: 0 }]);
  const removeRow = (ri) => setRows(rs => rs.filter((_, i) => i !== ri));

  const setW = (key, v) => { const n = parseFloat(v); setManual(m => ({ ...m, [key]: Number.isNaN(n) ? 0 : n })); };
  const resetW = () => setManual({});

  async function handleResumes(list) {
    setErr(""); if (!window.pdfjsLib || !window.JSZip) { setErr("Parser libraries didn't load — check your connection and reload."); return; } setBusy(true);
    try { const add = []; for (const f of Array.from(list)) { try { add.push(...await fileToCandidates(f)); } catch (x) { add.push({ name: f.name, resume: "", source: f.name, error: "Could not read file" }); } } setUploaded(p => [...p, ...add]); }
    catch (x) { setErr("Something went wrong while parsing."); } finally { setBusy(false); }
  }
  async function handleJD(file) { try { const t = await readTextFile(file); setJd(t); } catch (x) { setErr("Could not read that JD file."); } }

  return (
    <div className="wrap">
      <div className="hero">
        <div className="kicker">MK Recruitments · Logistic resume screener</div>
        <h1>StatScreen</h1>
        <p className="lede">Describe the role, choose the signals that matter, learn the weights from past hires (or set them by hand), then drop in resumes and score them.</p>
      </div>
      <div className="stats">
        <div className="chip"><b className="num">{predictors.length}</b><span>predictors</span></div>
        <div className="chip"><b className="num">{rows.length}</b><span>training rows</span></div>
        <div className="chip"><b className="num">{fit.converged ? "\u2713" : (rows.length ? "\u2026" : "—")}</b><span>model fit</span></div>
        <div className="chip"><b className="num">{anyManual ? "manual" : "auto"}</b><span>weights</span></div>
        <div className="chip"><b className="num">{shortlisted}/{readable.length}</b><span>shortlisted</span></div>
      </div>

      {/* 0 — saved screenings */}
      <section className="card">
        <div className="head"><span className="dot d3">✦</span><h2>Saved screenings</h2><span className="spacer"></span>
          <span className={"tag " + (mode === "api" ? "data" : "man")}>{mode === "api" ? "shared database" : "this browser"}</span></div>
        <p className="sub">Save the whole setup — JD, predictors, training data, weights and the candidate pool — and reload it later. {mode === "api" ? "Stored in your team's Turso database." : "Stored in this browser until you connect a database (see README)."}</p>
        <div className="row" style={{ marginTop: 8 }}>
          <input className="txt" style={{ maxWidth: 260 }} placeholder="screening name…" value={curName} onChange={e => setCurName(e.target.value)} />
          <button className="btn sm" onClick={doSave}>{curId ? "Update" : "Save"}</button>
          {curId && <button className="btn ghost sm" onClick={() => { setCurId(null); setCurName(""); }}>New</button>}
          <span className="spacer"></span>
          <select value={curId || ""} onChange={e => e.target.value && doLoad(e.target.value)}>
            <option value="">Load saved…</option>
            {screenings.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {curId && <button className="xbtn" title="delete this screening" onClick={doDelete}>×</button>}
          {saveMsg && <span className="src">{saveMsg}</span>}
        </div>
      </section>

      {/* 1 — JD */}
      <section className="card">
        <div className="head"><span className="dot d1">1</span><h2>Job description</h2></div>
        <p className="sub">Paste or upload the JD. The role context lives here, and StatScreen scans it for skills, locations, qualifications and exam terms you can drop straight into your predictors below.</p>
        <div className="row" style={{ margin: "12px 0" }}>
          <button className="btn ghost sm" onClick={() => jdRef.current && jdRef.current.click()}>Upload JD (PDF / TXT)</button>
          <input ref={jdRef} type="file" accept=".pdf,.txt" style={{ display: "none" }} onChange={e => { if (e.target.files[0]) handleJD(e.target.files[0]); e.target.value = ""; }} />
          <span className="src">{suggestions.length} signal term{suggestions.length !== 1 ? "s" : ""} detected</span>
        </div>
        <textarea rows={7} value={jd} onChange={e => setJd(e.target.value)} placeholder="Paste the job description here…"></textarea>
        {suggestions.length > 0 && <div className="chips" style={{ marginTop: 10 }}>
          {suggestions.map((s, i) => (<span className="pill" key={i}>{s}</span>))}
        </div>}
      </section>

      {/* 2 — predictors */}
      <section className="card">
        <div className="head"><span className="dot d2">2</span><h2>Predictors</h2><span className="spacer"></span>
          <button className="btn violet sm" onClick={addPred}>+ Add predictor</button></div>
        <p className="sub">These are the signals read out of each resume. Rename them, switch type, edit keywords, or click a <span className="sug" style={{ padding: "1px 7px" }}>+ from JD</span> chip to pull a term in. Add or remove as many as you like — the training table updates to match.</p>
        {predictors.map((p, i) => (<PredictorCard key={p.key} p={p} idx={i} suggestions={suggestions} upd={patch => updPred(p.key, patch)} remove={() => removePred(p.key)} />))}
        {predictors.length === 0 && <p className="muted" style={{ marginTop: 12 }}>No predictors yet — add one to begin.</p>}
      </section>

      {/* 3 — training data */}
      <section className="card">
        <div className="head"><span className="dot d3">3</span><h2>Training data</h2><span className="spacer"></span>
          <button className="btn ghost sm" onClick={addRow}>+ Row</button></div>
        <p className="sub">Past candidates, one per row, scored on each predictor. <b>Y = 1</b> means they turned out to be a good hire. The weights below refit instantly as you edit.</p>
        <div className="gridwrap">
          <table className="grid">
            <thead><tr>
              {predictors.map((p, i) => <th key={p.key} title={p.name}>X{i + 1}</th>)}
              <th style={{ color: "var(--primary-d)" }}>Y</th><th></th>
            </tr></thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {predictors.map(p => <td key={p.key}><input className="num" type="number" value={r.values[p.key] ?? 0} onChange={e => setCell(ri, p.key, e.target.value)} /></td>)}
                  <td><input className="num" type="number" min="0" max="1" value={r.y} onChange={e => setY(ri, e.target.value)} style={{ color: "var(--primary-d)", fontWeight: 600 }} /></td>
                  <td className="rm"><button title="remove row" onClick={() => removeRow(ri)}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="legend">{predictors.map((p, i) => `X${i + 1} = ${p.name}`).join("  ·  ")}</div>
      </section>

      {/* 4 — weights */}
      <section className="card">
        <div className="head"><span className="dot d4">4</span><h2>Weights</h2><span className="spacer"></span>
          {anyManual && <button className="btn ghost sm" onClick={resetW}>Reset to training</button>}</div>
        <p className="sub">By default these are learned from your training data. Slide or type to override any of them — overridden ones show a <span className="tag man">manual</span> tag; the rest keep tracking the data.</p>
        <WeightChart predictors={predictors} eff={eff} fitBeta={fit.beta} />
        <div className="wgrid">
          {predictors.map((p, i) => {
            const w = eff[i + 1], isMan = manual[p.key] !== undefined; return (
              <div className="weight" key={p.key}>
                <div className="top"><span className="id">X{i + 1}</span><span className="nm">{p.name}</span><span className="val num">{w >= 0 ? "+" : ""}{fmt(w)}</span></div>
                <div className="ctl">
                  <input type="range" min="-6" max="6" step="0.1" value={Math.max(-6, Math.min(6, w))} onChange={e => setW(p.key, e.target.value)} />
                  <input type="number" step="0.1" value={fmt(w)} onChange={e => setW(p.key, e.target.value)} />
                </div>
                <div style={{ marginTop: 7 }}>{isMan ? <span className="tag man">manual</span> : <span className="tag data">from data</span>}<span className="muted" style={{ marginLeft: 8 }}>learned {fmt(fit.beta[i + 1] ?? 0)}</span></div>
              </div>);
          })}
        </div>
        {predictors.length === 0 && <p className="muted">Add a predictor to set weights.</p>}
        <div className="row" style={{ marginTop: 14 }}>
          <span className="muted">Baseline (intercept)</span>
          <div className="slider-wide" style={{ marginLeft: "auto" }}>
            <input type="range" min="-10" max="10" step="0.1" value={Math.max(-10, Math.min(10, eff[0]))} onChange={e => setW("intercept", e.target.value)} />
            <input type="number" step="0.1" value={fmt(eff[0])} onChange={e => setW("intercept", e.target.value)} style={{ width: 78, fontFamily: "JetBrains Mono", border: "1px solid var(--line)", borderRadius: 8, padding: "5px 7px" }} />
          </div>
        </div>
        <div className="note">A weight's <b>sign</b> decides direction: positive lifts the hire probability, negative lowers it. The data sets sign and size; your edits can change either, so check a flipped sign is intended.</div>
      </section>

      {/* 5 — screen */}
      <section className="card">
        <div className="head"><span className="dot d5">5</span><h2>Screen resumes</h2></div>
        <p className="sub">Drop in PDFs or a ZIP. Each is read in your browser, scored on your predictors, and ranked by hire probability.</p>
        <div className={"drop" + (over ? " over" : "")} style={{ marginTop: 12 }}
          onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); handleResumes(e.dataTransfer.files); }}>
          <button className="btn" onClick={() => fileRef.current && fileRef.current.click()}>Choose files</button>
          <div className="hint">{busy ? "Reading files\u2026" : "\u2026or drag PDFs / a .zip here — nothing leaves your device"}</div>
          <input ref={fileRef} type="file" accept=".pdf,.zip,.txt" multiple style={{ display: "none" }} onChange={e => { handleResumes(e.target.files); e.target.value = ""; }} />
        </div>
        {err && <div className="err" style={{ marginTop: 10 }}>{err}</div>}
        {uploaded.length > 0 && <div className="row" style={{ marginTop: 10 }}><span className="src">{uploaded.length} uploaded</span><button className="btn ghost sm" onClick={() => setUploaded([])}>Clear</button></div>}

        <div className="row" style={{ marginTop: 16 }}>
          <div><span className="bignum num">{shortlisted}</span> <span className="muted">shortlisted of {readable.length}</span></div><div className="spacer"></div>
          <div><div className="muted" style={{ textAlign: "right" }}>shortlist cutoff {pct(threshold)}</div>
            <div className="slider-wide"><span className="src">0%</span><input type="range" min="0" max="1" step="0.01" value={threshold} onChange={e => setThreshold(parseFloat(e.target.value))} /><span className="src">100%</span></div></div>
        </div>

        <div className="muted" style={{ marginTop: 6 }}>Ranked by hire probability — click a bar to see why.</div>
        <CandidateBars list={readable} threshold={threshold} selKey={selected} onSelect={setSelected} />
        {selected && readable.find(c => c.source + "|" + c.name === selected) && <Contrib c={readable.find(c => c.source + "|" + c.name === selected)} predictors={predictors} eff={eff} />}

        <div className="tbl"><table className="res">
          <thead><tr><th>Candidate</th>{predictors.map((p, i) => <th key={p.key} className="r" title={p.name}>X{i + 1}</th>)}<th className="r">P(hire)</th><th>Decision</th><th>Source</th></tr></thead>
          <tbody>{candidates.map((c, i) => (
            <tr key={i}><td style={{ fontWeight: 600 }}>{c.name}</td>
              {predictors.map(p => <td key={p.key} className="r num">{c.error ? "\u2014" : (c.values[p.key] ?? "\u2014")}</td>)}
              <td className="r" style={{ minWidth: 84 }}>{c.error ? "\u2014" : <><div className="num">{pct(c.prob, 1)}</div><div className="minibar"><i className={c.prob >= threshold ? "go" : "hold"} style={{ width: (100 * c.prob) + "%" }}></i></div></>}</td>
              <td>{c.error ? <span className="badge warn">unreadable</span> : <span className={"badge " + (c.prob >= threshold ? "go" : "hold")}>{c.prob >= threshold ? "Shortlist" : "Hold"}</span>}</td>
              <td>{c.source === "sample" ? <span className="pill">sample</span> : <span className="src">{c.source}</span>}</td>
            </tr>))}</tbody>
        </table></div>
        <div className="note">Decision support, not a verdict — scores come from keyword detection plus your chosen weights (a location-style predictor can encode bias), so review the shortlist before acting.</div>
      </section>

      <div style={{ textAlign: "center", marginTop: 22 }}><span className="src">StatScreen · MK Recruitments · runs in your browser, saves to your database</span></div>
    </div>
  );
}
