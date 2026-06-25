# StatScreen — MK Recruitments

A configurable logistic-regression resume screener. Describe a role, choose the
predictors that matter, learn the weights from past hires (or set them by hand),
drop in resumes (PDF / ZIP / TXT, parsed in the browser), and get a ranked,
explainable shortlist.

This build is **frontend-only**: it runs entirely in the browser and saves
screenings to `localStorage`, so there's no server, no database, and no secrets
to manage. That makes it a one-click deploy on Lovable (or any static host).

Brand: MK Recruitments (navy `#103a82` + green `#1ba14a`); logo pinned bottom-right.

---

## 1. Run locally

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # production build -> dist/
npm run preview      # serve the production build locally
```

Open http://localhost:5173. Saved screenings live in **this browser's**
`localStorage` (the storage pill in the header says so).

---

## 2. Deploy live on Lovable

Lovable builds a Vite app from a connected GitHub repo and publishes it. Because
this build has no backend, there's nothing else to configure.

1. **Push this repo to GitHub** (already done if you're reading this there).
2. In Lovable, create a project and **connect this GitHub repo**
   (or use *GitHub → Import*). Lovable detects Vite automatically:
   - Build command: `npm run build`
   - Output directory: `dist`
3. Click **Publish**. Lovable gives you a live URL.

That's it — the app is live. No environment variables are required.

> **Why frontend-only?** Saved screenings are per-browser. If you later want a
> *shared* database across users, see "Growing into a shared DB" below — the
> storage layer is already written so the UI doesn't change.

### Other static hosts

The same `dist/` deploys to Netlify, Vercel, Cloudflare Pages or GitHub Pages —
build command `npm run build`, publish directory `dist`.

---

## 3. How it works

- **Predictors** turn resume text into numbers (regex / keyword / boolean /
  level extraction). You can override any extracted value per candidate.
- **Training** rows (past hires + outcome) feed a logistic regression fit with
  **IRLS + ridge** (`src/model.js`). You can also set weights by hand.
- **Scoring** standardizes each candidate and shows the probability plus the
  top per-predictor drivers, so every ranking is explainable.
- Resume reading (pdf.js / JSZip, loaded from CDN in `index.html`) happens in
  the browser — **files never leave the device**.

It's decision support, not a verdict. A location- or name-style predictor can
encode bias — review every shortlist before acting.

---

## 4. Project structure

```
mk-statscreen/
├─ index.html            # entry; loads fonts + pdf.js/JSZip (CDN) + brand badge
├─ public/mk-logo.svg    # MK Recruitments logo (bottom-right badge)
├─ src/
│  ├─ main.jsx           # React mount
│  ├─ App.jsx            # UI: role, predictors, training, model, candidates, saved
│  ├─ model.js           # logistic regression (IRLS + ridge) + scoring/metrics
│  ├─ extract.js         # in-browser resume reading + feature extraction
│  ├─ store.js           # persistence: localStorage (or API if VITE_API_URL set)
│  └─ styles.css         # MK brand styles
└─ vite.config.js        # Vite + React
```

---

## 5. Growing into a shared database (optional, later)

`src/store.js` already speaks to a REST API when a build-time `VITE_API_URL` is
set; otherwise it uses `localStorage`. To share screenings across users you'd
add a small backend exposing:

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/screenings` | list `{id,name,updated_at}` |
| GET | `/api/screenings/:id` | one screening incl. `data` |
| POST | `/api/screenings` | create `{name,data}` → `{id}` |
| PUT | `/api/screenings/:id` | update `{name,data}` |
| DELETE | `/api/screenings/:id` | delete |

A "screening" is one JSON document: `{ jd, predictors, rows, manual, threshold, fitMode, lambda, uploaded }`.
Deploy that API anywhere, set `VITE_API_URL=https://your-api` in Lovable's env,
and rebuild — the UI is unchanged. (Lovable's *native* backend is Supabase, so
a Supabase table behind those routes is the most Lovable-native path.)
