// Génère le site statique dans dist/ : pages d'accueil existantes + section /jeux
// (dashboard et une fiche par jeu) à partir de content/games/<slug>/game.json.
// Aucune dépendance : `node tools/build.mjs`.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const GAMES_DIR = join(ROOT, 'content', 'games');
const SITE = JSON.parse(readFileSync(join(ROOT, 'content', 'site.json'), 'utf8'));
// Service des demandes (feedback/) ; FEEDBACK_API permet de viser un service local pour les essais.
const FEEDBACK_API = (process.env.FEEDBACK_API ?? SITE.feedbackApi ?? '').replace(/\/$/, '');

// CSS / JS servis avec une empreinte de leur contenu (?v=…) : une mise à jour s'applique tout de suite,
// sans attendre la fin du cache du navigateur.
const ASSET_HASH = new Map();
function asset(path) {
    if (!ASSET_HASH.has(path)) {
        const file = join(ROOT, path.replace(/^\//, ''));
        ASSET_HASH.set(path, existsSync(file) ? createHash('sha1').update(readFileSync(file)).digest('hex').slice(0, 10) : '');
    }
    const v = ASSET_HASH.get(path);
    return v ? `${path}?v=${v}` : path;
}

// Captures montrées dans le carrousel d'une fiche (les suivantes sont ignorées).
const MAX_SHOTS = 3;

const STATIC = ['index.html', '404.html', 'CNAME', 'favicon.ico', 'profile.png', 'script.js', 'styles.css', 'icons', 'images', 'assets'];

const PLATFORMS = {
    windows: { label: 'Windows', detail: 'Windows 10 / 11 · 64 bits' },
    android: { label: 'Android', detail: 'APK · Android 7+' },
    macos: { label: 'macOS', detail: 'Universel · Intel et Apple Silicon' },
};

const ICONS = {
    windows: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5.5 10.5 4.4v7.1H3zm0 13L10.5 19.6v-7H3zm8.5 1.2L21 21V12.6h-9.5zm0-15.4v7.2H21V3z"/></svg>',
    android: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.2 9h9.6c.7 0 1.2.5 1.2 1.2V17c0 .7-.5 1.2-1.2 1.2H16V21a1 1 0 1 1-2 0v-2.8h-4V21a1 1 0 1 1-2 0v-2.8h-.8c-.7 0-1.2-.5-1.2-1.2v-6.8C6 9.5 6.5 9 7.2 9zM4 9.5a1 1 0 0 1 2 0v5a1 1 0 1 1-2 0zm14 0a1 1 0 1 1 2 0v5a1 1 0 1 1-2 0zM8.1 3.2l.9 1.4A6.2 6.2 0 0 1 12 4c1.1 0 2.1.2 3 .6l.9-1.4a.4.4 0 0 1 .7.4l-.9 1.4A5.3 5.3 0 0 1 18 8H6a5.3 5.3 0 0 1 2.3-3.4l-.9-1.4a.4.4 0 0 1 .7-.4zM9.5 6a.7.7 0 1 0 0 1.4.7.7 0 0 0 0-1.4zm5 0a.7.7 0 1 0 0 1.4.7.7 0 0 0 0-1.4z"/></svg>',
    macos: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5C4 4.7 4.7 4 5.5 4h13c.8 0 1.5.7 1.5 1.5V15H4zM6 6v7h12V6zM1.5 16.5h21l-.6 1.6c-.3.6-.9.9-1.5.9H3.6c-.6 0-1.2-.3-1.5-.9z"/></svg>',
    download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4a1 1 0 1 1 2 0v9.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.4l3.3 3.3zM5 19a1 1 0 1 0 0 2h14a1 1 0 1 0 0-2z"/></svg>',
};

// ---------- utilitaires ----------

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function inline(s) {
    return esc(s)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code>$1</code>');
}

// Markdown minimal : paragraphes, listes « - », titres « ### », gras, italique, code.
function md(text = '') {
    const out = [];
    let list = null;
    const flush = () => { if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; } };
    for (const block of String(text).split(/\n{2,}/)) {
        for (const line of block.split('\n')) {
            const t = line.trim();
            if (!t) continue;
            if (/^[-*] /.test(t)) { (list ??= []).push(`<li>${inline(t.slice(2))}</li>`); continue; }
            flush();
            if (t.startsWith('### ')) out.push(`<h3>${inline(t.slice(4))}</h3>`);
            else out.push(`<p>${inline(t)}</p>`);
        }
        flush();
    }
    return out.join('\n');
}

function humanSize(bytes) {
    if (!bytes) return '';
    const mb = bytes / 1024 / 1024;
    return mb >= 1000 ? `${(mb / 1024).toFixed(1).replace('.', ',')} Go` : `${Math.round(mb)} Mo`;
}

function humanDate(iso) {
    if (!iso) return '';
    return new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function hue(slug) {
    let h = 0;
    for (const c of slug) h = (h * 31 + c.charCodeAt(0)) % 360;
    return h;
}

// Dimensions d'un WebP (VP8, VP8L ou VP8X) sans dépendance.
function webpSize(path) {
    try {
        const b = readFileSync(path);
        if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
        const chunk = b.toString('ascii', 12, 16);
        if (chunk === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
        if (chunk === 'VP8L') { const v = b.readUInt32LE(21); return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1]; }
        if (chunk === 'VP8X') return [b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1];
    } catch { /* fichier absent : format par défaut */ }
    return null;
}

const fileUrl = (f) => `${SITE.downloadBase.replace(/\/$/, '')}/${f.file}`;

// ---------- chargement des jeux ----------

function loadGames() {
    if (!existsSync(GAMES_DIR)) return [];
    const games = [];
    for (const slug of readdirSync(GAMES_DIR)) {
        const path = join(GAMES_DIR, slug, 'game.json');
        if (!existsSync(path)) continue;
        const g = JSON.parse(readFileSync(path, 'utf8'));
        if (g.hidden) continue;
        g.slug = slug;
        g.versions = (g.versions ?? []).slice().sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.version.localeCompare(a.version, 'en', { numeric: true }));
        g.latest = g.versions.find((v) => v.available !== false && Object.keys(v.files ?? {}).length);
        if (!g.latest) continue; // rien à télécharger : pas de fiche publique
        g.platforms = Object.keys(PLATFORMS).filter((p) => g.latest.files[p]);
        g.media ??= {};
        g.genres ??= [];
        games.push(g);
    }
    return games.sort((a, b) => (b.latest.date ?? '').localeCompare(a.latest.date ?? ''));
}

// ---------- gabarits ----------

function layout({ title, description, path, image, body, scripts = [], bodyClass = '' }) {
    const url = `${SITE.siteUrl}${path}`;
    const img = image ? `${SITE.siteUrl}${image}` : `${SITE.siteUrl}/icons/android-chrome-512x512.png`;
    return `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#ffffff">
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}">
    <link rel="canonical" href="${url}">
    <meta property="og:type" content="website">
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(description)}">
    <meta property="og:url" content="${url}">
    <meta property="og:image" content="${img}">
    <meta name="twitter:card" content="summary_large_image">
    <link rel="stylesheet" href="${asset('/styles.css')}">
    <link rel="stylesheet" href="${asset('/assets/releases.css')}">
    <link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32x32.png">
</head>
<body class="releases${bodyClass ? ` ${bodyClass}` : ''}">
    <canvas id="plexus-canvas" aria-hidden="true"></canvas>
${body}
    <script src="${asset('/script.js')}" defer></script>
${scripts.map((s) => `    <script src="${asset(s)}" defer></script>`).join('\n')}
</body>
</html>
`;
}

function cover(g, cls = 'cover') {
    const src = g.media.cover ?? g.media.screenshots?.[0];
    if (src) return `<img class="${cls}" src="/jeux/${g.slug}/${src}" alt="" loading="lazy" decoding="async">`;
    const icon = g.media.icon ? `<img src="/jeux/${g.slug}/${g.media.icon}" alt="" loading="lazy">` : `<span>${esc(g.title[0])}</span>`;
    return `<div class="${cls} cover-fallback" style="--h:${hue(g.slug)}">${icon}</div>`;
}

const platformIcons = (g) => g.platforms.map((p) => `<span class="pf" title="${PLATFORMS[p].label}">${ICONS[p]}</span>`).join('');

function card(g) {
    const search = [g.title, g.tagline, ...g.genres].join(' ').toLowerCase();
    return `        <li class="game-card" data-search="${esc(search)}" data-platforms="${g.platforms.join(' ')}" data-genres="${esc(g.genres.join('|'))}" data-date="${g.latest.date ?? ''}" data-title="${esc(g.title.toLowerCase())}">
            <a href="/jeux/${g.slug}/">
                ${cover(g)}
                <div class="card-body">
                    <h2>${esc(g.title)}</h2>
                    <p>${esc(g.tagline ?? '')}</p>
                    <div class="card-meta">
                        <span class="platforms">${platformIcons(g)}</span>
                        <span>v${esc(g.latest.version)} · ${humanDate(g.latest.date)}</span>
                    </div>
                </div>
            </a>
        </li>`;
}

function dashboard(games) {
    const genres = [...new Set(games.flatMap((g) => g.genres))].sort((a, b) => a.localeCompare(b, 'fr'));
    const chip = (group, value, label, active = false) => `<button type="button" class="chip${active ? ' is-active' : ''}" data-group="${group}" data-value="${esc(value)}" aria-pressed="${active}">${label}</button>`;
    const body = `    <div class="page">
        <nav class="crumbs"><a href="/">Jeremy N. Martin</a></nav>
        <header class="hero hero-row">
            <h1 class="vt-jeux">Jeux</h1>
            ${FEEDBACK_API ? '<a class="hero-link" href="/jeux/ameliorations/">Améliorations, bugs, idées →</a>' : ''}
        </header>
        <div class="toolbar">
            <input type="search" id="q" placeholder="Rechercher un jeu…" aria-label="Rechercher un jeu" autocomplete="off">
            <select id="sort" aria-label="Trier">
                <option value="date">Plus récents</option>
                <option value="title">A → Z</option>
            </select>
        </div>
        <div class="filters" role="group" aria-label="Plateforme">
            ${chip('platform', '', 'Toutes plateformes', true)}
            ${Object.entries(PLATFORMS).map(([k, p]) => chip('platform', k, `${ICONS[k]}${p.label}`)).join('\n            ')}
        </div>
        ${genres.length ? `<div class="filters" role="group" aria-label="Genre">
            ${chip('genre', '', 'Tous genres', true)}
            ${genres.map((g) => chip('genre', g, esc(g))).join('\n            ')}
        </div>` : ''}
        <ul class="game-grid" id="grid">
${games.map(card).join('\n')}
        </ul>
        <p class="empty" id="empty" hidden>Aucun jeu ne correspond.</p>
    </div>`;
    return layout({
        title: 'Jeux · Jeremy N. Martin',
        description: 'Tous mes jeux Godot, gratuits et sans pub, à télécharger pour Windows, Android et macOS.',
        path: '/jeux/',
        body,
        scripts: ['/assets/releases.js'],
    });
}

// Guides pas à pas, un par plateforme, avec les libellés exacts des avertissements.
const steps = (items, after = '') => `<ol>${items.map((s) => `<li>${s}</li>`).join('')}</ol>${after}`;
const INSTALL = {
    windows: (g) => steps([
        'Si le navigateur prévient que le fichier « n’est pas souvent téléchargé », choisis <strong>Conserver</strong> (dans Edge : <strong>…</strong> → <strong>Conserver</strong>, puis <strong>Afficher plus</strong> → <strong>Conserver quand même</strong>).',
        'Lance le fichier <code>.exe</code>. Si Windows affiche « Windows a protégé votre ordinateur », clique sur <strong>Informations complémentaires</strong>, puis sur <strong>Exécuter quand même</strong>.',
        'C’est tout : rien à installer, le jeu s’ouvre directement. Tu peux ranger le fichier où tu veux.',
    ]),
    android: (g) => steps([
        'Télécharge le fichier <code>.apk</code> depuis ton téléphone. Si le navigateur dit que ce type de fichier peut être dangereux, choisis <strong>Télécharger quand même</strong>.',
        'Ouvre le fichier. La première fois, Android demande l’autorisation d’installer depuis cette source : touche <strong>Paramètres</strong>, active <strong>Autoriser cette source</strong>, puis reviens en arrière.',
        'Touche <strong>Installer</strong>. Si Play Protect signale une application inconnue, touche <strong>Plus de détails</strong>, puis <strong>Installer quand même</strong>.',
        'Les versions suivantes s’installent par-dessus, sans perdre ta progression.',
    ]),
    macos: (g) => steps([
        'Ouvre le <code>.zip</code> téléchargé (il se décompresse tout seul), puis glisse l’app dans <strong>Applications</strong>.',
        `Lance-la. macOS dit ne pas pouvoir vérifier l’app : clique sur <strong>Terminé</strong> (ou <strong>OK</strong>).`,
        'Ouvre <strong>Réglages Système</strong> → <strong>Confidentialité et sécurité</strong>, descends jusqu’au message sur le jeu, clique sur <strong>Ouvrir quand même</strong> et confirme avec ton mot de passe. Sur macOS 14 ou plus ancien, il suffit de faire un clic droit sur l’app → <strong>Ouvrir</strong> → <strong>Ouvrir</strong>.',
        'Les lancements suivants se font normalement.',
    ], `<p class="muted">Si macOS dit que l’app est « endommagée », ouvre le Terminal et lance : <code>xattr -cr "/Applications/${esc(g.title)}.app"</code></p>`),
};

const INSTALL_WHY = 'Windows, macOS et Android se méfient de tout ce qui ne vient pas de leur boutique ou d’un éditeur qui paie leur certification. Ces avertissements ne veulent pas dire que le jeu est dangereux : chaque fichier est publié avec son empreinte SHA-256, qui permet de vérifier qu’il n’a pas été modifié.';

function downloadRow(p, f, primary = false) {
    return `<a class="dl${primary ? ' dl-primary' : ''}" href="${esc(fileUrl(f))}" data-platform="${p}" download>
                    <span class="dl-icon">${ICONS[p]}</span>
                    <span class="dl-text"><strong>${PLATFORMS[p].label}</strong><small>${PLATFORMS[p].detail} · ${humanSize(f.size)}</small></span>
                    <span class="dl-arrow">${ICONS.download}</span>
                </a>`;
}

function gamePage(g) {
    const shots = (g.media.screenshots ?? []).slice(0, MAX_SHOTS);
    const v = g.latest;
    // Le cadre prend le format réel des captures (pas de bandes noires).
    const dims = shots.length ? webpSize(join(GAMES_DIR, g.slug, shots[0])) : null;
    const ratio = dims ? `${dims[0]} / ${dims[1]}` : '16 / 9';
    const gallery = shots.length
        ? `<div class="carousel" data-carousel style="--ratio: ${ratio}" aria-roledescription="carrousel" aria-label="Captures de ${esc(g.title)}">
                <div class="car-viewport">
                    <div class="car-track">
                        ${shots.map((s, i) => `<button type="button" class="car-slide" data-index="${i}" aria-label="Agrandir la capture ${i + 1} sur ${shots.length}"><img src="/jeux/${g.slug}/${s}" alt="Capture ${i + 1} de ${esc(g.title)}" ${i ? 'loading="lazy" ' : ''}decoding="async" draggable="false"></button>`).join('')}
                    </div>
                    ${shots.length > 1 ? `<button type="button" class="car-nav car-prev" aria-label="Capture précédente">‹</button>
                    <button type="button" class="car-nav car-next" aria-label="Capture suivante">›</button>` : ''}
                </div>
                ${shots.length > 1 ? `<div class="car-dots">${shots.map((_, i) => `<button type="button" class="car-dot" data-index="${i}" aria-label="Capture ${i + 1}"${i ? '' : ' aria-current="true"'}><span></span></button>`).join('')}</div>` : ''}
            </div>`
        : `<div class="gallery">${cover(g, 'gallery-fallback')}</div>`;

    const facts = [
        g.genres.length && ['Genre', g.genres.map(esc).join(', ')],
        g.players && ['Joueurs', esc(g.players)],
        g.language && ['Langue', esc(g.language)],
        g.status && ['Statut', esc(g.status)],
        ['Version', `${esc(v.version)} · ${humanDate(v.date)}`],
    ].filter(Boolean);

    const versions = g.versions.map((ver) => {
        const files = ver.available !== false ? Object.keys(PLATFORMS).filter((p) => ver.files?.[p]) : [];
        return `<li data-version="${esc(ver.version)}">
                    <div class="ver-head"><strong>v${esc(ver.version)}</strong><span>${humanDate(ver.date)}</span>${ver.milestone ? '<span class="badge">Jalon</span>' : ''}</div>
                    ${ver.notes ? `<div class="ver-notes">${md(ver.notes)}</div>` : ''}
                    ${files.length
                        ? `<div class="ver-files">${files.map((p) => `<a href="${esc(fileUrl(ver.files[p]))}" download>${ICONS[p]}${PLATFORMS[p].label} · ${humanSize(ver.files[p].size)}</a>`).join('')}</div>`
                        : '<div class="ver-files"><span class="muted">Archivée, plus téléchargeable</span></div>'}
                </li>`;
    }).join('\n                ');

    const checksums = g.platforms.map((p) => {
        const f = v.files[p];
        const scan = f.virustotal ? ` <a class="vt" href="${esc(f.virustotal)}" rel="noopener" target="_blank">Analyse VirusTotal</a>` : '';
        return `<li><span>${PLATFORMS[p].label}</span><span><code>${esc(f.sha256 ?? '')}</code>${scan}</span></li>`;
    }).join('');
    const scanned = g.platforms.some((p) => v.files[p].virustotal);

    const body = `    <div class="page">
        <nav class="crumbs"><a href="/">Jeremy N. Martin</a><span>/</span><a href="/jeux/">Jeux</a></nav>
        <article class="game">
            <div class="game-col">
            <div class="game-media">
            ${gallery}
            </div>
            <div class="game-main">
            <section class="prose">
                <h2>À propos</h2>
                ${md(g.summary ?? g.tagline ?? '')}
            </section>
            <section class="install">
                <h2>Installer</h2>
                <p class="install-why">${INSTALL_WHY}${scanned ? ' Chaque fichier est aussi analysé par VirusTotal (lien sous les empreintes).' : ''}</p>
                ${g.platforms.map((p) => `<details${p === g.platforms[0] ? ' open' : ''} data-platform="${p}"><summary>${ICONS[p]}${PLATFORMS[p].label}</summary>${INSTALL[p](g)}</details>`).join('\n                ')}
                <details><summary>Empreintes SHA-256${scanned ? ' et analyses' : ''} (v${esc(v.version)})</summary><ul class="sums">${checksums}</ul></details>
            </section>
            </div>
            </div>
            <div class="game-col">
            <aside class="game-side">
                <h1>${esc(g.title)}</h1>
                ${g.tagline ? `<p class="tagline">${esc(g.tagline)}</p>` : ''}
                ${g.genres.length ? `<div class="tags">${g.genres.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
                <div class="downloads" data-downloads>
                ${g.platforms.map((p, i) => downloadRow(p, v.files[p], i === 0)).join('\n                ')}
                </div>
                <p class="free">Gratuit · sans pub · sans compte</p>
                <div class="facts">
                    <dl>${facts.map(([k, val]) => `<dt>${k}</dt><dd>${val}</dd>`).join('')}</dl>
                </div>
            </aside>
            <div class="game-extra">
            ${g.controls ? `<section class="prose controls">
                <h2>Comment jouer</h2>
                ${md(g.controls)}
            </section>` : ''}
            ${FEEDBACK_API ? `<section class="improve" data-improve data-api="${esc(FEEDBACK_API)}" data-game="${g.slug}">
                <h2>Améliorer ${esc(g.title)}</h2>
                <p>Un bug, une idée, un détail qui gêne ? Chaque demande est lue, et tu peux suivre ce qu’elle devient.</p>
                <p class="improve-stats" data-improve-stats hidden></p>
                <div class="improve-actions">
                    <a class="btn btn-primary" href="/jeux/ameliorations/?jeu=${g.slug}#proposer">Signaler un bug ou proposer une idée</a>
                    <a class="btn" href="/jeux/ameliorations/?jeu=${g.slug}#demandes">Voir les demandes</a>
                </div>
            </section>` : ''}
            <section class="versions" id="versions">
                <h2>Versions</h2>
                <ul>
                ${versions}
                </ul>
            </section>
            </div>
            </div>
        </article>
    </div>
    <dialog class="lightbox" id="lightbox"><img alt=""><button type="button" class="lb-close" aria-label="Fermer">×</button></dialog>`;

    const image = g.media.cover ? `/jeux/${g.slug}/${g.media.cover}` : shots[0] ? `/jeux/${g.slug}/${shots[0]}` : undefined;
    return layout({
        title: `${g.title} · Jeux · Jeremy N. Martin`,
        description: g.tagline ?? `${g.title}, jeu gratuit pour ${g.platforms.map((p) => PLATFORMS[p].label).join(', ')}.`,
        path: `/jeux/${g.slug}/`,
        image,
        body,
        bodyClass: g.pixelArt ? 'pixel' : '',
        scripts: ['/assets/releases.js', '/assets/feedback.js'],
    });
}

const STATUS_LABELS = { attente: 'En attente', prevue: 'Prévue', implementee: 'Implémentée', refusee: 'Refusée' };

// Page /jeux/ameliorations/ : la démarche, le formulaire, le suivi par code et la liste publique.
function improvementsPage(games) {
    const catalog = games.map((g) => ({ slug: g.slug, title: g.title, version: g.latest.version, platforms: g.platforms }));
    const steps = [
        ['Tu proposes', 'Un bug, une idée, un détail qui gêne : tout est bon à prendre. Pas de compte, pas d’e-mail.'],
        ['Je lis tout', 'Chaque demande est relue. Un bug est reproduit, une idée est pesée face au reste du jeu.'],
        ['Je tranche', 'Elle passe à « Prévue » ou « Refusée », avec une réponse quand il y a quelque chose à expliquer.'],
        ['Ça sort', 'Une fois dans le jeu, elle passe à « Implémentée », avec le numéro de la version qui l’apporte.'],
    ];
    const statusChip = (value, label, active = false) => `<button type="button" class="chip${active ? ' is-active' : ''}" data-status="${value}" aria-pressed="${active}">${label}<span class="chip-count" data-count="${value}"></span></button>`;
    const body = `    <div class="page fb-page" data-feedback data-api="${esc(FEEDBACK_API)}">
        <nav class="crumbs"><a href="/">Jeremy N. Martin</a><span>/</span><a href="/jeux/">Jeux</a></nav>
        <header class="hero">
            <h1>Améliorations</h1>
            <p>Mes jeux ne sont jamais finis : ils changent par petites versions, au fil de ce que vivent ceux qui y jouent.</p>
        </header>

        <section class="fb-approach" aria-label="La démarche">
            <ol class="fb-steps">
                ${steps.map(([t, d], i) => `<li><span class="fb-num">${i + 1}</span><h2>${t}</h2><p>${d}</p></li>`).join('\n                ')}
            </ol>
            <p class="fb-why">Plutôt qu’une grosse refonte de temps en temps, chaque jeu reçoit des versions fréquentes qui corrigent, ajustent ou ajoutent un peu. Chaque changement est noté dans l’historique des versions de sa fiche. Une demande refusée n’est pas une mauvaise demande : elle peut aller contre l’esprit du jeu, en compliquer la prise en main, ou coûter trop cher pour ce qu’elle apporte.</p>
        </section>

        <section class="fb-block" id="proposer">
            <h2>Proposer</h2>
            <form class="fb-form" data-fb-form novalidate>
                <div class="fb-row">
                    <label>Jeu
                        <select name="game" required>
                            <option value="">Choisis un jeu…</option>
                            ${games.map((g) => `<option value="${g.slug}">${esc(g.title)}</option>`).join('\n                            ')}
                        </select>
                    </label>
                    <fieldset class="fb-kind">
                        <legend>Type</legend>
                        <label><input type="radio" name="kind" value="bug" checked><span>Bug</span></label>
                        <label><input type="radio" name="kind" value="idee"><span>Idée</span></label>
                        <label><input type="radio" name="kind" value="autre"><span>Autre</span></label>
                    </fieldset>
                </div>
                <label>Titre
                    <input name="title" required minlength="3" maxlength="120" autocomplete="off" placeholder="En une phrase">
                </label>
                <label>Détails
                    <textarea name="body" rows="6" maxlength="4000" placeholder="Ce que tu faisais, ce qui s’est passé, ce que tu attendais."></textarea>
                </label>
                <div class="fb-row">
                    <label>Plateforme
                        <select name="platform">
                            <option value="">—</option>
                            ${Object.entries(PLATFORMS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('')}
                            <option value="autre">Autre</option>
                        </select>
                    </label>
                    <label>Version du jeu
                        <input name="game_version" maxlength="20" autocomplete="off" placeholder="ex. 0.008">
                    </label>
                </div>
                <div class="fb-trap" aria-hidden="true"><label>Site web <input name="website" tabindex="-1" autocomplete="off"></label></div>
                <p class="fb-privacy">Tes détails restent privés. Seul le titre, éventuellement reformulé, apparaît dans la liste publique une fois la demande relue.</p>
                <div class="fb-actions">
                    <button type="submit" class="btn btn-primary">Envoyer</button>
                    <p class="fb-msg" data-fb-msg role="status" aria-live="polite"></p>
                </div>
            </form>
            <div class="fb-done" data-fb-done hidden>
                <h3>Merci, c’est envoyé.</h3>
                <p>Ton code de suivi : <strong class="fb-code" data-fb-code></strong></p>
                <p>Il est gardé dans ce navigateur, rubrique « Mes demandes ». Note-le pour suivre la demande depuis un autre appareil.</p>
                <button type="button" class="btn" data-fb-again>Envoyer une autre demande</button>
            </div>
        </section>

        <section class="fb-block" id="suivi">
            <h2>Suivre une demande</h2>
            <form class="fb-track" data-fb-track>
                <input name="code" placeholder="Code de suivi" maxlength="12" autocomplete="off" aria-label="Code de suivi" spellcheck="false">
                <button type="submit" class="btn">Voir</button>
            </form>
            <div data-fb-track-result></div>
            <div class="fb-mine" data-fb-mine hidden>
                <h3>Mes demandes</h3>
                <ul class="fb-list" data-fb-mine-list></ul>
            </div>
        </section>

        <section class="fb-block" id="demandes">
            <h2>Les demandes</h2>
            <div class="toolbar">
                <select data-fb-filter-game aria-label="Jeu">
                    <option value="">Tous les jeux</option>
                    ${games.map((g) => `<option value="${g.slug}">${esc(g.title)}</option>`).join('\n                    ')}
                </select>
            </div>
            <div class="filters" role="group" aria-label="État">
                ${statusChip('', 'Toutes', true)}
                ${Object.entries(STATUS_LABELS).map(([k, l]) => statusChip(k, l)).join('\n                ')}
            </div>
            <p class="muted fb-pending" data-fb-pending hidden></p>
            <ul class="fb-list" data-fb-list></ul>
            <p class="empty" data-fb-empty hidden>Aucune demande relue pour l’instant.</p>
        </section>
        <script type="application/json" id="fb-games">${JSON.stringify(catalog).replace(/</g, '\\u003c')}</script>
    </div>`;
    return layout({
        title: 'Améliorations · Jeux · Jeremy N. Martin',
        description: 'Signale un bug ou propose une idée pour mes jeux, et suis ce que devient ta demande.',
        path: '/jeux/ameliorations/',
        body,
        scripts: ['/assets/feedback.js'],
    });
}

// ---------- build ----------

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
for (const entry of STATIC) {
    if (existsSync(join(ROOT, entry))) cpSync(join(ROOT, entry), join(DIST, entry), { recursive: true });
}
// Pages statiques copiées telles quelles : leurs CSS / JS reçoivent aussi l'empreinte.
for (const page of ['index.html', '404.html']) {
    const file = join(DIST, page);
    if (!existsSync(file)) continue;
    const html = readFileSync(file, 'utf8').replace(/(href|src)="(\/?)((?:assets\/)?[\w.-]+\.(?:css|js))"/g,
        (m, attr, slash, path) => `${attr}="${slash}${asset('/' + path).slice(1)}"`);
    writeFileSync(file, html);
}

const games = loadGames();
const rel = join(DIST, 'jeux');
mkdirSync(rel, { recursive: true });
writeFileSync(join(rel, 'index.html'), dashboard(games));
// La page des demandes n'existe que si le service (feedback/) est configuré dans content/site.json.
if (FEEDBACK_API) {
    mkdirSync(join(rel, 'ameliorations'), { recursive: true });
    writeFileSync(join(rel, 'ameliorations', 'index.html'), improvementsPage(games));
}

for (const g of games) {
    const dir = join(rel, g.slug);
    mkdirSync(dir, { recursive: true });
    const media = join(GAMES_DIR, g.slug, 'media');
    if (existsSync(media)) cpSync(media, join(dir, 'media'), { recursive: true });
    writeFileSync(join(dir, 'index.html'), gamePage(g));
}

// Anciennes adresses /releases/… (première mise en ligne) : redirection vers /jeux/….
const redirect = (to) => `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><title>Jeux</title>
<link rel="canonical" href="${SITE.siteUrl}${to}"><meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url=${to}"><script>location.replace(${JSON.stringify(to)} + location.hash)</script>
</head><body><a href="${to}">Jeux</a></body></html>
`;
for (const to of ['/jeux/', ...games.map((g) => `/jeux/${g.slug}/`)]) {
    const dir = join(DIST, 'releases', to.slice('/jeux/'.length));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), redirect(to));
}

// Index machine-lisible (pour d'autres outils, ou une future app « launcher »).
writeFileSync(join(rel, 'games.json'), JSON.stringify(games.map((g) => ({
    slug: g.slug,
    title: g.title,
    tagline: g.tagline,
    genres: g.genres,
    version: g.latest.version,
    date: g.latest.date,
    url: `${SITE.siteUrl}/jeux/${g.slug}/`,
    downloads: Object.fromEntries(g.platforms.map((p) => [p, { url: fileUrl(g.latest.files[p]), size: g.latest.files[p].size, sha256: g.latest.files[p].sha256 }])),
})), null, 2));

const urls = ['/', '/jeux/', ...(FEEDBACK_API ? ['/jeux/ameliorations/'] : []), ...games.map((g) => `/jeux/${g.slug}/`)];
writeFileSync(join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${SITE.siteUrl}${u}</loc></url>`).join('\n')}
</urlset>
`);

console.log(`dist/ prêt : ${games.length} jeu(x) publié(s).`);
