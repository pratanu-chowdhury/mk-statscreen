// StatScreen server: Express API backed by Turso (libSQL), and static host
// for the built frontend. The Turso auth token lives ONLY here (server-side)
// and is never shipped to the browser.
import express from "express";
import { createClient } from "@libsql/client";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "8mb" }));

// CORS — allows a separately-hosted frontend (e.g. on Lovable) to call this API.
// Set CORS_ORIGIN to your frontend's URL in production; defaults to "*".
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

let db = null;
if (url) {
  db = createClient({ url, authToken });
  await db.execute(`CREATE TABLE IF NOT EXISTS screenings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  console.log("Connected to Turso.");
} else {
  console.log("No TURSO_DATABASE_URL set — /api is disabled, frontend will use browser storage.");
}

const needDb = (res) => {
  if (!db) { res.status(503).json({ error: "Database not configured" }); return true; }
  return false;
};

app.get("/api/health", (req, res) => {
  if (!db) return res.status(503).json({ ok: false, reason: "no TURSO_DATABASE_URL" });
  res.json({ ok: true });
});

app.get("/api/screenings", async (req, res) => {
  if (needDb(res)) return;
  const r = await db.execute("SELECT id, name, updated_at FROM screenings ORDER BY updated_at DESC");
  res.json(r.rows);
});

app.get("/api/screenings/:id", async (req, res) => {
  if (needDb(res)) return;
  const r = await db.execute({ sql: "SELECT id, name, data, updated_at FROM screenings WHERE id = ?", args: [req.params.id] });
  if (!r.rows.length) return res.status(404).json({ error: "Not found" });
  const row = r.rows[0];
  res.json({ id: row.id, name: row.name, updated_at: row.updated_at, data: JSON.parse(row.data) });
});

app.post("/api/screenings", async (req, res) => {
  if (needDb(res)) return;
  const { name, data } = req.body;
  const r = await db.execute({ sql: "INSERT INTO screenings(name, data) VALUES(?, ?)", args: [name || "Untitled", JSON.stringify(data ?? {})] });
  res.json({ id: Number(r.lastInsertRowid) });
});

app.put("/api/screenings/:id", async (req, res) => {
  if (needDb(res)) return;
  const { name, data } = req.body;
  await db.execute({ sql: "UPDATE screenings SET name = ?, data = ?, updated_at = datetime('now') WHERE id = ?", args: [name || "Untitled", JSON.stringify(data ?? {}), req.params.id] });
  res.json({ id: Number(req.params.id) });
});

app.delete("/api/screenings/:id", async (req, res) => {
  if (needDb(res)) return;
  await db.execute({ sql: "DELETE FROM screenings WHERE id = ?", args: [req.params.id] });
  res.json({ ok: true });
});

// Serve the built frontend (after `npm run build`).
const dist = path.join(__dirname, "..", "dist");
app.use(express.static(dist));
app.get("*", (req, res) => res.sendFile(path.join(dist, "index.html")));

const port = process.env.PORT || 8787;
app.listen(port, () => console.log(`StatScreen running on http://localhost:${port}  (db: ${db ? "turso" : "off"})`));
