// API des demandes des joueurs (bugs, idées) pour jnm.app/jeux, sur Cloudflare Workers + D1.
//
// Public :
//   GET  /v1/requests?game=<slug>   demandes relues + nombre de demandes par état
//   GET  /v1/requests/<code>        suivi d'une demande par son code
//   POST /v1/requests               envoi d'une demande
// Administration (Authorization: Bearer ADMIN_TOKEN) :
//   GET    /v1/admin/requests?status=&game=
//   PATCH  /v1/admin/requests/<code>   { status, title, note, done_version, public }
//   DELETE /v1/admin/requests/<code>   (spam)

const STATUSES = ['attente', 'prevue', 'implementee', 'refusee'];
const KINDS = ['bug', 'idee', 'autre'];
const ORIGINS = ['https://jnm.app', 'http://localhost:3000', 'http://localhost:3123'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O ni 1/I
const PER_HOUR = 5;   // envois par personne et par heure
const PER_DAY = 300;  // envois au total par jour (filet contre une attaque)

const LIMITS = { title: [3, 120], body: [0, 4000], platform: [0, 40], game_version: [0, 20] };

export default {
    async fetch(request, env) {
        const cors = corsHeaders(request);
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        try {
            const res = await route(request, env);
            for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
            return res;
        } catch (err) {
            if (err instanceof HttpError) return json({ error: err.message }, err.status, cors);
            console.error(err);
            return json({ error: 'Erreur interne' }, 500, cors);
        }
    },
};

class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}

function corsHeaders(request) {
    const origin = request.headers.get('Origin');
    return {
        'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
    };
}

function json(data, status = 200, headers = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
    });
}

async function route(request, env) {
    const url = new URL(request.url);
    const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    if (parts[0] !== 'v1') throw new HttpError(404, 'Introuvable');

    if (parts[1] === 'requests') {
        if (parts.length === 2 && request.method === 'GET') return listPublic(env, url);
        if (parts.length === 2 && request.method === 'POST') return create(env, request);
        if (parts.length === 3 && request.method === 'GET') return track(env, parts[2]);
    }
    if (parts[1] === 'admin' && parts[2] === 'requests') {
        await requireAdmin(env, request);
        if (parts.length === 3 && request.method === 'GET') return listAdmin(env, url);
        if (parts.length === 4 && request.method === 'PATCH') return update(env, parts[3], request);
        if (parts.length === 4 && request.method === 'DELETE') return remove(env, parts[3]);
    }
    throw new HttpError(404, 'Introuvable');
}

// ---------- public ----------

async function listPublic(env, url) {
    const game = url.searchParams.get('game');
    const where = game ? 'WHERE game = ?1' : '';
    const binds = game ? [game] : [];
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    const { results: countRows } = await env.DB.prepare(`SELECT status, COUNT(*) AS n FROM requests ${where} GROUP BY status`).bind(...binds).all();
    for (const r of countRows) counts[r.status] = r.n;
    const { results } = await env.DB.prepare(
        `SELECT code, game, kind, title, status, note, done_version, created_at, updated_at FROM requests
         WHERE public = 1 ${game ? 'AND game = ?1' : ''} ORDER BY updated_at DESC LIMIT 500`,
    ).bind(...binds).all();
    return json({ counts, items: results });
}

async function track(env, code) {
    const row = await env.DB.prepare(
        'SELECT code, game, kind, title, body, platform, game_version, status, note, done_version, created_at, updated_at FROM requests WHERE code = ?1',
    ).bind(String(code).toUpperCase()).first();
    if (!row) throw new HttpError(404, 'Aucune demande avec ce code');
    return json(row);
}

async function create(env, request) {
    let data;
    try { data = await request.json(); } catch { throw new HttpError(400, 'Requête illisible'); }

    // Champ piège invisible pour les humains : un robot le remplit, on fait semblant d'accepter.
    if (data.website) return json({ code: randomCode() }, 201);

    const kind = KINDS.includes(data.kind) ? data.kind : null;
    if (!kind) throw new HttpError(400, 'Type de demande inconnu');
    const game = String(data.game ?? '');
    if (!(await knownGames(env)).has(game)) throw new HttpError(400, 'Jeu inconnu');
    const clean = {};
    for (const [field, [min, max]] of Object.entries(LIMITS)) {
        const v = String(data[field] ?? '').replace(/\r\n/g, '\n').trim();
        if (v.length < min || v.length > max) {
            throw new HttpError(400, field === 'title' ? `Le titre doit faire entre ${min} et ${max} caractères` : `Champ trop long : ${field}`);
        }
        clean[field] = v;
    }

    const ip = request.headers.get('CF-Connecting-IP') ?? '';
    const now = new Date();
    const ipHash = await sha256(`${env.IP_SALT}|${ip}|${now.toISOString().slice(0, 10)}`);
    const hourAgo = new Date(now - 3600_000).toISOString();
    const dayAgo = new Date(now - 86400_000).toISOString();
    const recent = await env.DB.prepare(
        'SELECT SUM(ip_hash = ?1 AND created_at > ?2) AS mine, COUNT(*) AS all_day FROM requests WHERE created_at > ?3',
    ).bind(ipHash, hourAgo, dayAgo).first();
    if ((recent?.mine ?? 0) >= PER_HOUR) throw new HttpError(429, 'Trop d’envois rapprochés : réessaie dans une heure');
    if ((recent?.all_day ?? 0) >= PER_DAY) throw new HttpError(429, 'Trop de demandes aujourd’hui : réessaie demain');

    const stamp = now.toISOString();
    for (let attempt = 0; attempt < 5; attempt++) {
        const code = randomCode();
        try {
            await env.DB.prepare(
                `INSERT INTO requests (code, game, kind, title, body, platform, game_version, ip_hash, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`,
            ).bind(code, game, kind, clean.title, clean.body, clean.platform, clean.game_version, ipHash, stamp).run();
            return json({ code }, 201);
        } catch (err) {
            if (!String(err).includes('UNIQUE')) throw err;
        }
    }
    throw new HttpError(500, 'Impossible de créer un code de suivi');
}

// Liste des jeux publiés, lue sur le site (mise en cache une heure par Cloudflare).
async function knownGames(env) {
    const res = await fetch(env.GAMES_URL, { cf: { cacheTtl: 3600, cacheEverything: true } });
    if (!res.ok) throw new HttpError(503, 'Liste des jeux indisponible');
    return new Set((await res.json()).map((g) => g.slug));
}

// ---------- administration ----------

async function requireAdmin(env, request) {
    const given = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const [a, b] = await Promise.all([sha256(given), sha256(env.ADMIN_TOKEN ?? '')]);
    if (!env.ADMIN_TOKEN || a !== b) throw new HttpError(401, 'Non autorisé');
}

async function listAdmin(env, url) {
    const cond = [];
    const binds = [];
    for (const key of ['status', 'game']) {
        const v = url.searchParams.get(key);
        if (v) { binds.push(v); cond.push(`${key} = ?${binds.length}`); }
    }
    const { results } = await env.DB.prepare(
        `SELECT code, game, kind, title, body, platform, game_version, status, public, note, done_version, created_at, updated_at
         FROM requests ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''} ORDER BY created_at ASC LIMIT 1000`,
    ).bind(...binds).all();
    return json({ items: results });
}

async function update(env, code, request) {
    const data = await request.json();
    const sets = [];
    const binds = [];
    const put = (col, v) => { binds.push(v); sets.push(`${col} = ?${binds.length}`); };
    if (data.status !== undefined) {
        if (!STATUSES.includes(data.status)) throw new HttpError(400, 'État inconnu');
        put('status', data.status);
    }
    if (data.title !== undefined) put('title', String(data.title).trim().slice(0, LIMITS.title[1]));
    if (data.note !== undefined) put('note', String(data.note).trim().slice(0, 1000));
    if (data.done_version !== undefined) put('done_version', String(data.done_version).trim().slice(0, 20));
    if (data.public !== undefined) put('public', data.public ? 1 : 0);
    if (!sets.length) throw new HttpError(400, 'Rien à modifier');
    put('updated_at', new Date().toISOString());
    binds.push(String(code).toUpperCase());
    const res = await env.DB.prepare(`UPDATE requests SET ${sets.join(', ')} WHERE code = ?${binds.length}`).bind(...binds).run();
    if (!res.meta.changes) throw new HttpError(404, 'Aucune demande avec ce code');
    return track(env, code);
}

async function remove(env, code) {
    const res = await env.DB.prepare('DELETE FROM requests WHERE code = ?1').bind(String(code).toUpperCase()).run();
    if (!res.meta.changes) throw new HttpError(404, 'Aucune demande avec ce code');
    return json({ deleted: code });
}

// ---------- utilitaires ----------

function randomCode() {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

async function sha256(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
