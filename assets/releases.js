(function () {
    'use strict';

    // ---------- dashboard : recherche, filtres, tri ----------

    const grid = document.getElementById('grid');
    if (grid) {
        const cards = Array.from(grid.children);
        const q = document.getElementById('q');
        const sort = document.getElementById('sort');
        const empty = document.getElementById('empty');
        const state = { platform: '', genre: '' };

        function apply() {
            const text = q.value.trim().toLowerCase();
            let shown = 0;
            for (const card of cards) {
                const ok = (!text || card.dataset.search.includes(text))
                    && (!state.platform || card.dataset.platforms.split(' ').includes(state.platform))
                    && (!state.genre || card.dataset.genres.split('|').includes(state.genre));
                card.hidden = !ok;
                if (ok) shown++;
            }
            empty.hidden = shown > 0;
        }

        function reorder() {
            const key = sort.value;
            cards.sort((a, b) => key === 'title'
                ? a.dataset.title.localeCompare(b.dataset.title, 'fr')
                : b.dataset.date.localeCompare(a.dataset.date));
            grid.append(...cards);
        }

        document.querySelectorAll('.chip').forEach((chip) => {
            chip.addEventListener('click', () => {
                const group = chip.dataset.group;
                state[group] = chip.dataset.value;
                document.querySelectorAll(`.chip[data-group="${group}"]`).forEach((c) => {
                    const on = c === chip;
                    c.classList.toggle('is-active', on);
                    c.setAttribute('aria-pressed', String(on));
                });
                apply();
            });
        });
        q.addEventListener('input', apply);
        sort.addEventListener('change', reorder);
    }

    // ---------- fiche : plateforme détectée en premier ----------

    const downloads = document.querySelector('[data-downloads]');
    if (downloads) {
        const ua = navigator.userAgent;
        const os = /Android/i.test(ua) ? 'android'
            : /Macintosh|Mac OS X/i.test(ua) && !/iPhone|iPad/i.test(ua) ? 'macos'
            : /Windows/i.test(ua) ? 'windows' : '';
        const mine = os && downloads.querySelector(`.dl[data-platform="${os}"]`);
        if (mine) {
            downloads.querySelectorAll('.dl').forEach((d) => d.classList.toggle('dl-primary', d === mine));
            downloads.prepend(mine);
            document.querySelectorAll('.install details[data-platform]').forEach((d) => { d.open = d.dataset.platform === os; });
        }
    }

    // ---------- fiche : galerie et agrandissement ----------

    const gallery = document.querySelector('[data-gallery]');
    if (gallery) {
        const main = gallery.querySelector('.gallery-main img');
        gallery.querySelectorAll('.thumb').forEach((thumb) => {
            thumb.addEventListener('click', () => {
                main.src = thumb.dataset.src;
                gallery.querySelectorAll('.thumb').forEach((t) => t.classList.toggle('is-active', t === thumb));
            });
        });

        const box = document.getElementById('lightbox');
        const big = box.querySelector('img');
        gallery.querySelector('[data-open]').addEventListener('click', () => {
            big.src = main.src;
            big.alt = main.alt;
            box.showModal();
        });
        box.addEventListener('click', () => box.close());
    }
})();
