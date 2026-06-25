// In-browser resume reading + feature extraction.
//
// Reading: TXT directly, PDF via pdf.js, ZIP via JSZip (both loaded from CDN in
// index.html and attached to window). Files never leave the device.
//
// Extraction: each predictor turns resume text into one number, by kind:
//   number  — first regex capture parsed as a float (e.g. years of experience)
//   keyword — count of listed terms (or 1/0 in binary mode)
//   boolean — 1 if any listed term appears, else 0
//   level   — max score among matched terms (e.g. PhD=4 … Bachelor=2)

const pdfjs = typeof window !== "undefined" ? window.pdfjsLib : null;
if (pdfjs) {
  pdfjs.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

async function readPdf(arrayBuffer) {
  if (!pdfjs) throw new Error("pdf.js not loaded");
  const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  let text = "";
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    text += content.items.map((i) => i.str).join(" ") + "\n";
  }
  return text;
}

// Returns [{ name, text }] for every resume found in the dropped files.
export async function readFiles(fileList) {
  const out = [];
  for (const file of Array.from(fileList)) {
    const lower = file.name.toLowerCase();
    try {
      if (lower.endsWith(".txt")) {
        out.push({ name: file.name, text: await file.text() });
      } else if (lower.endsWith(".pdf")) {
        out.push({ name: file.name, text: await readPdf(await file.arrayBuffer()) });
      } else if (lower.endsWith(".zip")) {
        if (!window.JSZip) throw new Error("JSZip not loaded");
        const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
        const names = Object.keys(zip.files).filter(
          (n) => !zip.files[n].dir && /\.(pdf|txt)$/i.test(n)
        );
        for (const n of names) {
          const entry = zip.files[n];
          const base = n.split("/").pop();
          if (/\.txt$/i.test(n)) {
            out.push({ name: base, text: await entry.async("string") });
          } else {
            out.push({ name: base, text: await readPdf(await entry.async("arraybuffer")) });
          }
        }
      }
    } catch (e) {
      out.push({ name: file.name, text: "", error: String(e.message || e) });
    }
  }
  return out;
}

function countTerms(text, terms) {
  const hay = text.toLowerCase();
  let n = 0;
  for (const raw of terms) {
    const t = raw.trim().toLowerCase();
    if (!t) continue;
    const re = new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    n += (hay.match(re) || []).length;
  }
  return n;
}

// One predictor -> one number for a given resume text.
export function extractValue(predictor, text) {
  const cfg = predictor.config || {};
  const fallback = Number.isFinite(predictor.fallback) ? predictor.fallback : 0;
  if (!text) return fallback;
  try {
    switch (predictor.kind) {
      case "number": {
        const re = new RegExp(cfg.pattern || "(\\d+(?:\\.\\d+)?)", "i");
        const m = text.match(re);
        return m ? parseFloat(m[1] ?? m[0]) : fallback;
      }
      case "keyword": {
        const terms = (cfg.terms || "").split(",");
        const c = countTerms(text, terms);
        return cfg.mode === "binary" ? (c > 0 ? 1 : 0) : c;
      }
      case "boolean": {
        const terms = (cfg.terms || "").split(",");
        return countTerms(text, terms) > 0 ? 1 : 0;
      }
      case "level": {
        // cfg.levels: "phd=4, master=3, mba=3, bachelor=2"
        let best = fallback;
        for (const pair of (cfg.levels || "").split(",")) {
          const [term, val] = pair.split("=").map((s) => (s || "").trim());
          if (!term) continue;
          if (countTerms(text, [term]) > 0) best = Math.max(best, parseFloat(val) || 0);
        }
        return best;
      }
      default:
        return fallback;
    }
  } catch {
    return fallback;
  }
}

export function extractAll(predictors, text) {
  return predictors.map((p) => extractValue(p, text));
}
