// Storage layer for saved screenings.
//
// Frontend-only build (Lovable / any static host): there is no API, so we use
// the browser's localStorage. If a VITE_API_URL is provided at build time the
// same calls transparently hit a deployed Express + Turso API instead — that's
// how you'd later graduate to a shared database without touching the UI.

const API = import.meta.env.VITE_API_URL || "";
const KEY = "mk-statscreen:screenings";

export const mode = API ? "shared database" : "this browser";

// ---- localStorage backend ----------------------------------------------------
function lsAll() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}
function lsWrite(items) {
  localStorage.setItem(KEY, JSON.stringify(items));
}

const local = {
  async list() {
    return lsAll()
      .map(({ id, name, updated_at }) => ({ id, name, updated_at }))
      .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  },
  async get(id) {
    return lsAll().find((s) => String(s.id) === String(id)) || null;
  },
  async save({ id, name, data }) {
    const items = lsAll();
    const now = new Date().toISOString();
    if (id != null) {
      const i = items.findIndex((s) => String(s.id) === String(id));
      if (i >= 0) {
        items[i] = { ...items[i], name, data, updated_at: now };
        lsWrite(items);
        return { id };
      }
    }
    const newId = Date.now();
    items.push({ id: newId, name, data, updated_at: now });
    lsWrite(items);
    return { id: newId };
  },
  async remove(id) {
    lsWrite(lsAll().filter((s) => String(s.id) !== String(id)));
  },
};

// ---- API backend (only used when VITE_API_URL is set) ------------------------
async function api(path, opts) {
  const res = await fetch(`${API}/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.status === 204 ? null : res.json();
}

const remote = {
  list: () => api("/screenings"),
  get: (id) => api(`/screenings/${id}`),
  save: ({ id, name, data }) =>
    id != null
      ? api(`/screenings/${id}`, { method: "PUT", body: JSON.stringify({ name, data }) }).then(
          () => ({ id })
        )
      : api("/screenings", { method: "POST", body: JSON.stringify({ name, data }) }),
  remove: (id) => api(`/screenings/${id}`, { method: "DELETE" }),
};

const backend = API ? remote : local;

export const listScreenings = (...a) => backend.list(...a);
export const getScreening = (...a) => backend.get(...a);
export const saveScreening = (...a) => backend.save(...a);
export const deleteScreening = (...a) => backend.remove(...a);
