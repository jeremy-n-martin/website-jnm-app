// Tri des demandes des joueurs (service feedback/, api.jnm.app). Aucune dépendance.
//
//   node tools/feedback.mjs list [--status attente] [--game <slug>]
//   node tools/feedback.mjs show <code>
//   node tools/feedback.mjs set <code> [--status prevue|implementee|refusee|attente] [--title "…"] [--note "…"]
//                                      [--version 0.009] [--public | --private]
//   node tools/feedback.mjs done <version> <code> [<code>…]      implémentées dans cette version (et publiques)
//   node tools/feedback.mjs delete <code>                          spam uniquement
//
// Jeton d'administration : FEEDBACK_ADMIN_TOKEN dans ~/.jnm/feedback.env (jamais affiché).

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = JSON.parse(readFileSync(join(ROOT, 'content', 'site.json'), 'utf8'));
const API = (process.env.FEEDBACK_API ?? SITE.feedbackApi ?? 'https://api.jnm.app/v1').replace(/\/$/, '');
const STATUSES = ['attente', 'prevue', 'implementee', 'refusee'];

function token() {
    const file = join(homedir(), '.jnm', 'feedback.env');
    if (process.env.FEEDBACK_ADMIN_TOKEN) return process.env.FEEDBACK_ADMIN_TOKEN;
    if (!existsSync(file)) fail(`Jeton absent : ${file}`);
    const line = readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.startsWith('FEEDBACK_ADMIN_TOKEN='));
    if (!line) fail(`FEEDBACK_ADMIN_TOKEN absent de ${file}`);
    return line.slice('FEEDBACK_ADMIN_TOKEN='.length).trim().replace(/^"|"$/g, '');
}

function fail(msg) {
    console.error(`✗ ${msg}`);
    process.exit(1);
}

async function call(path, options = {}) {
    const res = await fetch(API + path, {
        ...options,
        headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) fail(`${res.status} ${data?.error ?? res.statusText}`);
    return data;
}

function parse(argv) {
    const args = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--public') args.public = true;
        else if (a === '--private') args.public = false;
        else if (a.startsWith('--')) args[a.slice(2)] = argv[++i];
        else args._.push(a);
    }
    return args;
}

function print(r) {
    const flag = r.public ? 'public' : 'privé';
    console.log(`${r.code}  ${r.status.padEnd(11)} ${flag.padEnd(6)} ${r.game} · ${r.kind}${r.done_version ? ` · v${r.done_version}` : ''}`);
    console.log(`    ${r.title}`);
    if (r.body) console.log(r.body.split('\n').map((l) => `    | ${l}`).join('\n'));
    if (r.platform || r.game_version) console.log(`    (${[r.platform, r.game_version && `v${r.game_version}`].filter(Boolean).join(', ')})`);
    if (r.note) console.log(`    → ${r.note}`);
}

const [cmd, ...rest] = process.argv.slice(2);
const args = parse(rest);

switch (cmd) {
    case 'list': {
        const q = new URLSearchParams();
        if (args.status) q.set('status', args.status);
        if (args.game) q.set('game', args.game);
        const { items } = await call(`/admin/requests${q.size ? `?${q}` : ''}`);
        if (!items.length) console.log('Aucune demande.');
        for (const r of items) { print(r); console.log(); }
        break;
    }
    case 'show': {
        const { items } = await call('/admin/requests');
        const r = items.find((x) => x.code === String(args._[0] ?? '').toUpperCase());
        if (!r) fail('Aucune demande avec ce code');
        print(r);
        break;
    }
    case 'set': {
        const code = args._[0] ?? fail('Code manquant');
        const body = {};
        if (args.status !== undefined) {
            if (!STATUSES.includes(args.status)) fail(`État inconnu (${STATUSES.join(', ')})`);
            body.status = args.status;
        }
        if (args.title !== undefined) body.title = args.title;
        if (args.note !== undefined) body.note = args.note;
        if (args.version !== undefined) body.done_version = args.version;
        if (args.public !== undefined) body.public = args.public;
        // Une demande tranchée (prévue, implémentée, refusée) devient publique sauf avis contraire.
        if (body.status && body.status !== 'attente' && body.public === undefined) body.public = true;
        print(await call(`/admin/requests/${encodeURIComponent(code)}`, { method: 'PATCH', body: JSON.stringify(body) }));
        break;
    }
    case 'done': {
        const [version, ...codes] = args._;
        if (!version || !codes.length) fail('Usage : done <version> <code> [<code>…]');
        for (const code of codes) {
            print(await call(`/admin/requests/${encodeURIComponent(code)}`, {
                method: 'PATCH',
                body: JSON.stringify({ status: 'implementee', done_version: version, public: true }),
            }));
        }
        break;
    }
    case 'delete': {
        const code = args._[0] ?? fail('Code manquant');
        await call(`/admin/requests/${encodeURIComponent(code)}`, { method: 'DELETE' });
        console.log(`Supprimée : ${code}`);
        break;
    }
    default:
        console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 11).join('\n'));
}
