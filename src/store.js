// Storage abstraction. If the server API (Turso) is reachable it is used;
// otherwise everything falls back to this browser's localStorage so the app
// is fully usable before any database is connected.
// Set VITE_API_URL to an absolute origin (e.g. https://your-api.onrender.com)
// when the frontend and API are hosted separately (e.g. Lovable + Render).
const API = (import.meta.env && import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace(/\/$/, "") : "") + "/api";
const LS_KEY = "mk_statscreen_screenings";

let _mode = null; // 'api' | 'local'
async function probe() {
  if (_mode) return _mode;
  try {
    const r = await fetch(`${API}/health`);
    _mode = r.ok ? "api" : "local";
  } catch {
    _mode = "local";
  }
  return _mode;
}

export async function storageMode() {
  return probe();
}

function lsAll() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch { return []; }
}
function lsWrite(arr) {
  localStorage.setItem(LS_KEY, JSON.stringify(arr));
}

export async function listScreenings() {
  if ((await probe()) === "api") {
    const r = await fetch(`${API}/screenings`);
    return r.json();
  }
  return lsAll()
    .map(({ id, name, updated_at }) => ({ id, name, updated_at }))
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}

export async function getScreening(id) {
  if ((await probe()) === "api") {
    const r = await fetch(`${API}/screenings/${id}`);
    if (!r.ok) return null;
    return r.json();
  }
  return lsAll().find((s) => String(s.id) === String(id)) || null;
}

export async function saveScreening(name, data, id) {
  if ((await probe()) === "api") {
    const opts = {
      method: id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, data }),
    };
    const r = await fetch(id ? `${API}/screenings/${id}` : `${API}/screenings`, opts);
    return r.json();
  }
  const arr = lsAll();
  const now = new Date().toISOString();
  if (id) {
    const i = arr.findIndex((s) => String(s.id) === String(id));
    if (i >= 0) arr[i] = { ...arr[i], name, data, updated_at: now };
  } else {
    id = "loc" + Date.now();
    arr.push({ id, name, data, updated_at: now });
  }
  lsWrite(arr);
  return { id };
}

export async function deleteScreening(id) {
  if ((await probe()) === "api") {
    await fetch(`${API}/screenings/${id}`, { method: "DELETE" });
    return;
  }
  lsWrite(lsAll().filter((s) => String(s.id) !== String(id)));
}
