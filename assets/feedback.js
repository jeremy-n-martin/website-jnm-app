(function () {
    'use strict';

    // Demandes des joueurs (bugs, idées) : page /jeux/ameliorations/ et bloc « Améliorer » des fiches.
    // Les textes viennent des joueurs : ils sont toujours insérés avec textContent, jamais en HTML.

    const STATUS = { attente: 'En attente', prevue: 'Prévue', implementee: 'Implémentée', refusee: 'Refusée' };
    const KIND = { bug: 'Bug', idee: 'Idée', autre: 'Autre' };
    const MINE_KEY = 'jnm-feedback-mine';
    const DOWN = 'Le service des demandes ne répond pas. Réessaie dans un moment.';

    async function api(base, path, options) {
        const res = await fetch(base + path, options);
        let data = null;
        try { data = await res.json(); } catch { /* réponse vide */ }
        if (!res.ok) throw new Error((data && data.error) || DOWN);
        return data;
    }

    function el(tag, cls, text) {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function plural(n, one, many) { return `${n} ${n > 1 ? many : one}`; }

    function date(iso) {
        return iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    }

    function readMine() {
        try { return JSON.parse(localStorage.getItem(MINE_KEY)) || []; } catch { return []; }
    }

    function saveMine(list) {
        try { localStorage.setItem(MINE_KEY, JSON.stringify(list.slice(0, 50))); } catch { /* stockage indisponible */ }
    }

    // Une demande dans une liste : état, jeu, type, titre, réponse, version.
    function item(r, titles, withBody) {
        const li = el('li', `fb-item is-${r.status}`);
        const head = el('div', 'fb-item-head');
        head.append(el('span', `fb-status is-${r.status}`, STATUS[r.status] || r.status));
        if (r.status === 'implementee' && r.done_version) {
            const v = el('a', 'fb-version', `v${r.done_version}`);
            v.href = `/jeux/${encodeURIComponent(r.game)}/#versions`;
            head.append(v);
        }
        head.append(el('span', 'fb-meta', [titles[r.game] || r.game, KIND[r.kind] || r.kind, date(r.updated_at || r.created_at)].join(' · ')));
        li.append(head, el('p', 'fb-title', r.title));
        if (withBody && r.body) li.append(el('p', 'fb-body', r.body));
        if (r.note) li.append(el('p', 'fb-note', r.note));
        return li;
    }

    function countsLine(counts) {
        const parts = [];
        if (counts.attente) parts.push(plural(counts.attente, 'en attente', 'en attente'));
        if (counts.prevue) parts.push(plural(counts.prevue, 'prévue', 'prévues'));
        if (counts.implementee) parts.push(plural(counts.implementee, 'implémentée', 'implémentées'));
        if (counts.refusee) parts.push(plural(counts.refusee, 'refusée', 'refusées'));
        return parts.join(' · ');
    }

    // ---------- bloc « Améliorer » d'une fiche de jeu ----------

    const improve = document.querySelector('[data-improve]');
    if (improve && improve.dataset.api) {
        const base = improve.dataset.api;
        const game = improve.dataset.game;
        api(base, `/requests?game=${encodeURIComponent(game)}`).then((data) => {
            const line = countsLine(data.counts || {});
            const stats = improve.querySelector('[data-improve-stats]');
            if (line) { stats.textContent = `Demandes : ${line}`; stats.hidden = false; }
            // Les demandes implémentées apparaissent aussi sous la version qui les apporte.
            for (const r of data.items || []) {
                if (r.status !== 'implementee' || !r.done_version) continue;
                const li = document.querySelector(`.versions li[data-version="${CSS.escape(r.done_version)}"]`);
                if (!li) continue;
                let box = li.querySelector('.ver-requests');
                if (!box) { box = el('ul', 'ver-requests'); li.append(box); }
                box.append(el('li', '', r.title));
            }
        }).catch(() => { /* le bloc reste utile sans les chiffres */ });
    }

    // ---------- page /jeux/ameliorations/ ----------

    const page = document.querySelector('[data-feedback]');
    if (!page) return;
    const base = page.dataset.api;
    const games = JSON.parse(document.getElementById('fb-games').textContent);
    const titles = Object.fromEntries(games.map((g) => [g.slug, g.title]));
    const params = new URLSearchParams(location.search);

    // --- formulaire ---
    const form = page.querySelector('[data-fb-form]');
    const msg = page.querySelector('[data-fb-msg]');
    const done = page.querySelector('[data-fb-done]');
    const gameSelect = form.elements.game;
    const versionInput = form.elements.game_version;
    const body = form.elements.body;
    const PLACEHOLDERS = {
        bug: 'Ce que tu faisais, ce qui s’est passé, ce que tu attendais.',
        idee: 'Ce que tu aimerais, et ce que ça changerait pour toi en jouant.',
        autre: 'Ce que tu veux me dire.',
    };

    function syncGame() {
        const g = games.find((x) => x.slug === gameSelect.value);
        versionInput.placeholder = g ? `ex. ${g.version}` : 'ex. 0.008';
        if (g && !versionInput.dataset.touched) versionInput.value = g.version;
        if (g && g.platforms.length === 1 && !form.elements.platform.value) form.elements.platform.value = g.platforms[0];
    }
    gameSelect.addEventListener('change', syncGame);
    versionInput.addEventListener('input', () => { versionInput.dataset.touched = '1'; });
    form.addEventListener('change', (e) => { if (e.target.name === 'kind') body.placeholder = PLACEHOLDERS[e.target.value]; });
    if (params.get('jeu') && titles[params.get('jeu')]) { gameSelect.value = params.get('jeu'); syncGame(); }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        msg.className = 'fb-msg';
        const data = Object.fromEntries(new FormData(form));
        if (!data.game) { msg.textContent = 'Choisis le jeu concerné.'; gameSelect.focus(); return; }
        if ((data.title || '').trim().length < 3) { msg.textContent = 'Donne un titre d’au moins 3 caractères.'; form.elements.title.focus(); return; }
        const button = form.querySelector('[type="submit"]');
        button.disabled = true;
        msg.textContent = 'Envoi…';
        try {
            const res = await api(base, '/requests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            const mine = readMine().filter((m) => m.code !== res.code);
            mine.unshift({ code: res.code, game: data.game, title: data.title.trim(), at: new Date().toISOString() });
            saveMine(mine);
            page.querySelector('[data-fb-code]').textContent = res.code;
            form.hidden = true;
            done.hidden = false;
            msg.textContent = '';
            renderMine();
            loadList();
        } catch (err) {
            msg.textContent = err.message || DOWN;
            msg.classList.add('is-error');
        } finally {
            button.disabled = false;
        }
    });

    page.querySelector('[data-fb-again]').addEventListener('click', () => {
        const keep = gameSelect.value;
        form.reset();
        delete versionInput.dataset.touched;
        gameSelect.value = keep;
        syncGame();
        done.hidden = true;
        form.hidden = false;
        form.elements.title.focus();
    });

    // --- suivi par code ---
    const track = page.querySelector('[data-fb-track]');
    const trackResult = page.querySelector('[data-fb-track-result]');

    async function showTrack(code) {
        trackResult.replaceChildren();
        code = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!code) return;
        try {
            const r = await api(base, `/requests/${encodeURIComponent(code)}`);
            const list = el('ul', 'fb-list');
            list.append(item(r, titles, true));
            trackResult.append(list);
        } catch (err) {
            trackResult.append(el('p', 'fb-msg is-error', err.message || DOWN));
        }
    }

    track.addEventListener('submit', (e) => { e.preventDefault(); showTrack(track.elements.code.value); });
    if (params.get('suivi')) { track.elements.code.value = params.get('suivi'); showTrack(params.get('suivi')); }

    // --- mes demandes (gardées dans ce navigateur) ---
    const mineBox = page.querySelector('[data-fb-mine]');
    const mineList = page.querySelector('[data-fb-mine-list]');

    async function renderMine() {
        const mine = readMine();
        mineBox.hidden = !mine.length;
        if (!mine.length) return;
        const rows = await Promise.all(mine.slice(0, 20).map((m) =>
            api(base, `/requests/${encodeURIComponent(m.code)}`).catch(() => null).then((r) => ({ m, r }))));
        mineList.replaceChildren();
        const kept = [];
        for (const { m, r } of rows) {
            if (!r) {
                // demande supprimée (spam) ou service indisponible : on affiche ce qu'on sait
                kept.push(m);
                const li = item({ status: 'attente', game: m.game, kind: '', title: m.title, created_at: m.at }, titles);
                li.querySelector('.fb-meta').textContent = `${titles[m.game] || m.game} · code ${m.code}`;
                mineList.append(li);
                continue;
            }
            kept.push(m);
            const li = item(r, titles);
            li.querySelector('.fb-meta').textContent += ` · code ${r.code}`;
            mineList.append(li);
        }
        saveMine(kept.concat(mine.slice(20)));
    }

    // --- liste publique ---
    const list = page.querySelector('[data-fb-list]');
    const empty = page.querySelector('[data-fb-empty]');
    const pending = page.querySelector('[data-fb-pending]');
    const filterGame = page.querySelector('[data-fb-filter-game]');
    const state = { status: '', items: [], counts: {} };
    if (params.get('jeu') && titles[params.get('jeu')]) filterGame.value = params.get('jeu');

    function renderList() {
        const shown = state.items.filter((r) => !state.status || r.status === state.status);
        list.replaceChildren(...shown.map((r) => item(r, titles)));
        empty.hidden = shown.length > 0;
        const total = Object.values(state.counts).reduce((a, b) => a + b, 0);
        page.querySelectorAll('[data-count]').forEach((c) => {
            const n = c.dataset.count ? state.counts[c.dataset.count] || 0 : total;
            c.textContent = n ? ` ${n}` : '';
        });
        // Les demandes pas encore relues comptent, mais leur texte n'est pas public.
        const unread = (state.counts.attente || 0) - state.items.filter((r) => r.status === 'attente').length;
        pending.hidden = unread <= 0 || (state.status && state.status !== 'attente');
        pending.textContent = unread > 0 ? `${plural(unread, 'demande reçue attend', 'demandes reçues attendent')} d’être relue${unread > 1 ? 's' : ''}.` : '';
    }

    async function loadList() {
        const game = filterGame.value;
        try {
            const data = await api(base, `/requests${game ? `?game=${encodeURIComponent(game)}` : ''}`);
            state.items = data.items || [];
            state.counts = data.counts || {};
            renderList();
        } catch (err) {
            list.replaceChildren();
            empty.hidden = false;
            empty.textContent = err.message || DOWN;
        }
    }

    page.querySelectorAll('[data-status]').forEach((chip) => {
        chip.addEventListener('click', () => {
            state.status = chip.dataset.status;
            page.querySelectorAll('[data-status]').forEach((c) => {
                const on = c === chip;
                c.classList.toggle('is-active', on);
                c.setAttribute('aria-pressed', String(on));
            });
            renderList();
        });
    });
    filterGame.addEventListener('change', loadList);

    if (!base) {
        empty.hidden = false;
        empty.textContent = DOWN;
        form.querySelector('[type="submit"]').disabled = true;
        return;
    }
    renderMine();
    loadList();
})();
