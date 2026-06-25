# StatScreen — MK Recruitments

A configurable logistic-regression resume screener. Describe a role, choose the
predictors that matter, learn the weights from past hires (or set them by hand),
drop in resumes (PDF / ZIP / TXT, parsed in the browser), and get a ranked,
explainable shortlist. Saved screenings persist to a **Turso (SQLite)** database,
with an automatic **browser-storage fallback** so it runs before any DB exists.

Brand: MK Recruitments (navy `#103a82` + green `#1ba14a`); logo pinned bottom-right.

---

## 1. Run locally (no database needed)

```bash
npm install
npm run dev          # web on http://localhost:5173, api on http://localhost:8787
```

Open http://localhost:5173. With no Turso credentials set, "Saved screenings"
uses this browser's `localStorage` — the panel shows **this browser**.

> `npm run dev` starts the Vite dev server and the API server together. To run
> only the frontend: `npm run dev:web`.

---

## 2. Connect Turso (SQLite) for shared, persistent storage

Install the Turso CLI (https://docs.turso.tech), then:

```bash
turso db create mk-statscreen
turso db show mk-statscreen --url        # -> TURSO_DATABASE_URL  (libsql://...)
turso db tokens create mk-statscreen     # -> TURSO_AUTH_TOKEN
```

Create a `.env` from the template and paste both in:

```bash
cp .env.example .env
# edit .env:
# TURSO_DATABASE_URL=libsql://mk-statscreen-<org>.turso.io
# TURSO_AUTH_TOKEN=ey...
```

Run again — the server creates the `screenings` table automatically (or apply
`schema.sql` yourself: `turso db shell mk-statscreen < schema.sql`). The panel
now shows **shared database**, and saved screenings are visible to everyone
pointing at the same DB.

**Security:** the Turso token is read **only** by the Node server (`server/index.js`).
It is never bundled into the frontend. The browser only ever talks to `/api`.

---

## 3. Hosting

The app is two pieces: a **static frontend** (built by Vite) and a small
**API server** (`server/index.js`) that holds the Turso token. You can deploy
them together or apart.

### Option A — one Node host (simplest): Render / Railway / Fly.io

The Express server serves the built frontend *and* the API from one origin.

```bash
npm run build        # outputs dist/
npm start            # serves dist/ + /api on $PORT
```

On the host: build command `npm install && npm run build`, start command
`npm start`, and set env vars `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` (the host
provides `PORT`). Done — one URL, no CORS, no `VITE_API_URL` needed.

### Option B — Lovable frontend + Turso behind a deployed API

Lovable hosts the **frontend**; the **API + Turso** live on a small Node host.

1. **Deploy the API** (Option A host, or any Node host). Note its URL, e.g.
   `https://mk-statscreen-api.onrender.com`. Set `TURSO_*` there, and set
   `CORS_ORIGIN` to your Lovable URL.
2. **Bring the app into Lovable.** Push this repo to GitHub and connect it in
   Lovable (or recreate the UI there and drop in `src/`). Lovable builds the Vite
   frontend.
3. **Point the frontend at the API.** In Lovable's project env, set
   `VITE_API_URL=https://mk-statscreen-api.onrender.com` (used at build time).
   The frontend will call that origin's `/api`; CORS allows it.
4. Publish. Saved screenings now flow Lovable → API → Turso.

> **Heads-up on Lovable + Turso:** Lovable's *native* one-click backend is
> **Supabase (Postgres)**, not Turso. Turso works fine via the API layer above
> (which is the whole reason that layer exists — a browser app can't safely hold
> the Turso token). If you'd rather use Lovable's native path, swap `server/` for
> a Supabase table + the generated client and keep the same `src/store.js` shape;
> everything else is unchanged.

### Option C — frontend only (no server)

If single-user / per-browser saving is enough, just deploy `dist/` to any static
host (Netlify, Vercel, GitHub Pages, Lovable). With no API reachable, the app
stays in `localStorage` mode automatically. No database, no secrets.

---

## 4. Project structure

```
mk-statscreen/
├─ index.html            # entry; loads fonts + pdf.js/JSZip (CDN) + brand logo badge
├─ public/mk-logo.jpg    # MK Recruitments logo (bottom-right badge)
├─ src/
│  ├─ main.jsx           # React mount
│  ├─ App.jsx            # the whole app (model + extraction + UI + save/load)
│  ├─ store.js           # storage layer: Turso API if present, else localStorage
│  └─ styles.css         # MK brand styles
├─ server/index.js       # Express API + Turso (libSQL); serves dist/ in prod
├─ schema.sql            # SQLite schema (server also auto-creates it)
├─ .env.example          # TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, PORT, CORS_ORIGIN, VITE_API_URL
└─ vite.config.js        # dev proxy /api -> :8787
```

## 5. API

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | DB connected? |
| GET | `/api/screenings` | list `{id,name,updated_at}` |
| GET | `/api/screenings/:id` | one screening incl. `data` |
| POST | `/api/screenings` | create `{name,data}` → `{id}` |
| PUT | `/api/screenings/:id` | update `{name,data}` |
| DELETE | `/api/screenings/:id` | delete |

A "screening" is one JSON document: `{ jd, predictors, rows, manual, threshold, uploaded }`.

## Notes & limits

- Resume reading is keyword/regex extraction in the browser (pdf.js / JSZip), not
  full NLP. Files never leave the device during scoring.
- The model is logistic regression (IRLS + ridge); weights can be learned or set
  by hand. It's decision support — a location-style predictor can encode bias, so
  review shortlists before acting.
