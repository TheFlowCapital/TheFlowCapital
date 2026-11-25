// TheFlow Capital — API única. Todas las rutas entran por /api?r=<ruta>.
// Público: catalogo, me, estado, login, logout. Todo lo demás exige la sesión del panel.
import { neon } from '@neondatabase/serverless';
import { put, del } from '@vercel/blob';
import { createHmac, timingSafeEqual } from 'node:crypto';

const DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
const PASSWORD = process.env.ADMIN_PASSWORD || '';
const SECRET = PASSWORD + '|' + (process.env.SESSION_SECRET || 'theflow');
const COOKIE = 'tf_s';
const DIAS = 30;
const PUB_KEYS = ['precio', 'moneda', 'version', 'condicion', 'tipo', 'combustible', 'transmision', 'traccion', 'motor', 'cilindros', 'uso', 'unidad', 'exterior', 'interior', 'puertas', 'pasajeros', 'obs'];

let sql = null;
let listo = null;
function db() {
  if (!DB_URL) throw Object.assign(new Error('Falta la base de datos (DATABASE_URL).'), { code: 'config' });
  if (!sql) sql = neon(DB_URL);
  if (!listo) {
    listo = sql`CREATE TABLE IF NOT EXISTS tf_docs (id text PRIMARY KEY, data text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`
      .catch((e) => { listo = null; throw e; });
  }
  return listo.then(() => sql);
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}
const firma = (texto) => createHmac('sha256', SECRET).update(texto).digest('hex');
function igual(a, b) {
  const x = Buffer.from(firma('c:' + a)), y = Buffer.from(firma('c:' + b));
  return x.length === y.length && timingSafeEqual(x, y);
}
function esAdmin(request) {
  if (!PASSWORD) return false;
  const m = (request.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
  if (!m) return false;
  const [exp, sig] = decodeURIComponent(m[1]).split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return igual(sig, firma(exp));
}
function cookie(valor, segundos) {
  return `${COOKIE}=${encodeURIComponent(valor)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${segundos}`;
}
const lleno = (v) => v != null && String(v).trim() !== '';
const esFoto = (u) => typeof u === 'string' && /^https:\/\/[a-z0-9.-]+\.blob\.vercel-storage\.com\//i.test(u);
function leer(texto) { try { return JSON.parse(texto); } catch { return null; } }

async function todos() {
  const q = await db();
  const filas = await q`SELECT id, data FROM tf_docs`;
  const out = { cfg: { socio: 'Ronny Arias', pct: 30, whatsapp: '' }, veh: {} };
  for (const f of filas) {
    const d = leer(f.data);
    if (!d) continue;
    if (f.id === 'cfg') out.cfg = { ...out.cfg, ...d };
    else out.veh[f.id] = d;
  }
  return out;
}

// Lo único que sale al público: nunca gastos, venta interna, VIN ni socio.
function catalogo({ cfg, veh }) {
  const autos = Object.entries(veh)
    .filter(([, v]) => v && v.pub && v.pub.on)
    .sort((a, b) => (a[1].creado || 0) - (b[1].creado || 0))
    .map(([id, v]) => {
      const a = { id, marca: v.marca || '', modelo: v.modelo || '', anio: v.anio || '', vendido: v.estado === 'Vendido', fotos: (v.fotos || []).filter(esFoto) };
      for (const k of PUB_KEYS) if (lleno(v.pub[k])) a[k] = String(v.pub[k]);
      a.acc = Array.isArray(v.pub.acc) ? v.pub.acc.map(String) : [];
      return a;
    });
  return { whatsapp: String(cfg.whatsapp || '').replace(/\D/g, ''), autos };
}

async function cuerpo(request) {
  const t = await request.text();
  if (t.length > 400000) throw Object.assign(new Error('Demasiado grande.'), { code: 'grande' });
  return leer(t) || {};
}

async function manejar(request) {
  const url = new URL(request.url);
  const r = url.searchParams.get('r') || '';
  const metodo = request.method;

  if (r === 'estado') return json({ baseDeDatos: !!DB_URL, fotos: !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID), clave: !!PASSWORD });
  if (r === 'me') return json({ admin: esAdmin(request), configurado: !!PASSWORD });
  if (r === 'catalogo' && metodo === 'GET') return json(catalogo(await todos()));

  if (r === 'login' && metodo === 'POST') {
    if (!PASSWORD) return json({ error: 'config' }, 503);
    const { password } = await cuerpo(request);
    if (typeof password !== 'string' || !igual(password, PASSWORD)) {
      await new Promise((ok) => setTimeout(ok, 700));
      return json({ error: 'clave' }, 401);
    }
    const exp = String(Date.now() + DIAS * 86400000);
    return json({ admin: true }, 200, { 'Set-Cookie': cookie(exp + '.' + firma(exp), DIAS * 86400) });
  }
  if (r === 'logout' && metodo === 'POST') return json({ admin: false }, 200, { 'Set-Cookie': cookie('', 0) });

  if (!esAdmin(request)) return json({ error: 'sesion' }, 401);

  if (r === 'data' && metodo === 'GET') return json(await todos());

  if (r === 'save' && metodo === 'POST') {
    const { id, data } = await cuerpo(request);
    if (!(id === 'cfg' || /^v-[a-z0-9]{6,40}$/.test(id || '')) || !data || typeof data !== 'object' || Array.isArray(data)) return json({ error: 'datos' }, 400);
    if (id !== 'cfg') { data.fotos = (Array.isArray(data.fotos) ? data.fotos : []).filter(esFoto).slice(0, 30); delete data.foto; delete data.id; }
    const q = await db();
    const texto = JSON.stringify(data);
    await q`INSERT INTO tf_docs (id, data) VALUES (${id}, ${texto}) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
    return json({ ok: true });
  }

  if (r === 'borrar' && metodo === 'POST') {
    const { id } = await cuerpo(request);
    if (!/^v-[a-z0-9]{6,40}$/.test(id || '')) return json({ error: 'datos' }, 400);
    const q = await db();
    const filas = await q`SELECT data FROM tf_docs WHERE id = ${id}`;
    const fotos = filas[0] ? ((leer(filas[0].data) || {}).fotos || []).filter(esFoto) : [];
    await q`DELETE FROM tf_docs WHERE id = ${id}`;
    if (fotos.length) await del(fotos).catch(() => {});
    return json({ ok: true });
  }

  if (r === 'foto' && metodo === 'POST') {
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > 3000000) return json({ error: 'grande' }, 413);
    const blob = await put('vehiculos/foto.jpg', bytes, { access: 'public', addRandomSuffix: true, contentType: 'image/jpeg' });
    return json({ url: blob.url });
  }

  if (r === 'fotoborrar' && metodo === 'POST') {
    const { url: u } = await cuerpo(request);
    if (!esFoto(u)) return json({ error: 'datos' }, 400);
    await del(u).catch(() => {});
    return json({ ok: true });
  }

  return json({ error: 'ruta' }, 404);
}

export default {
  async fetch(request) {
    try {
      return await manejar(request);
    } catch (e) {
      console.error(e);
      const admin = esAdmin(request);
      return json({ error: e.code === 'config' ? 'config' : e.code === 'grande' ? 'grande' : 'servidor', detalle: admin ? String(e.message || e) : undefined }, e.code === 'grande' ? 413 : 500);
    }
  },
};
