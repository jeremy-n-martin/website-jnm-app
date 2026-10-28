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

    // ---------- fiche : carrousel des captures ----------

    const carousel = document.querySelector('[data-carousel]');
    if (carousel) {
        const INTERVAL = 3000; // garder égal à --interval dans releases.css
        const track = carousel.querySelector('.car-track');
        const slides = Array.from(carousel.querySelectorAll('.car-slide'));
        const dots = Array.from(carousel.querySelectorAll('.car-dot'));
        const viewport = carousel.querySelector('.car-viewport');
        const box = document.getElementById('lightbox');
        const big = box.querySelector('img');
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        let index = 0;
        let timer = null;
        let hovering = false;

        function go(i) {
            index = (i + slides.length) % slides.length;
            track.style.transform = `translateX(${-index * 100}%)`;
            dots.forEach((d, k) => {
                if (k === index) d.setAttribute('aria-current', 'true');
                else d.removeAttribute('aria-current');
            });
            // Relance l'animation de progression de la pastille active.
            const bar = dots[index]?.querySelector('span');
            if (bar) { bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = ''; }
            if (box.open) { big.src = slides[index].querySelector('img').src; }
        }

        function play() {
            stop();
            if (reduceMotion || slides.length < 2 || hovering || box.open || document.hidden) return;
            carousel.classList.add('is-playing');
            timer = setInterval(() => go(index + 1), INTERVAL);
        }

        function stop() {
            clearInterval(timer);
            timer = null;
            carousel.classList.remove('is-playing');
        }

        // Clic sur une image : agrandissement (le défilement s'arrête).
        slides.forEach((s, k) => s.addEventListener('click', () => {
            if (moved) return;
            go(k);
            big.src = s.querySelector('img').src;
            big.alt = s.querySelector('img').alt;
            stop();
            box.showModal();
        }));
        dots.forEach((d, k) => d.addEventListener('click', () => { go(k); play(); }));
        carousel.querySelector('.car-prev')?.addEventListener('click', () => { go(index - 1); play(); });
        carousel.querySelector('.car-next')?.addEventListener('click', () => { go(index + 1); play(); });

        // Pause au survol pour laisser le temps de regarder.
        carousel.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { hovering = true; stop(); } });
        carousel.addEventListener('pointerleave', () => { hovering = false; play(); });
        document.addEventListener('visibilitychange', play);

        // Balayage au doigt.
        let startX = null;
        let moved = false;
        viewport.addEventListener('pointerdown', (e) => { startX = e.clientX; moved = false; });
        viewport.addEventListener('pointerup', (e) => {
            if (startX === null) return;
            const dx = e.clientX - startX;
            startX = null;
            if (Math.abs(dx) > 40) { moved = true; go(index + (dx < 0 ? 1 : -1)); play(); setTimeout(() => { moved = false; }, 0); }
        });

        box.addEventListener('click', () => box.close());
        box.addEventListener('close', play);
        document.addEventListener('keydown', (e) => {
            if (!box.open && !carousel.contains(document.activeElement)) return;
            if (e.key === 'ArrowRight') { go(index + 1); play(); }
            if (e.key === 'ArrowLeft') { go(index - 1); play(); }
        });

        go(0);
        play();
    }
})();
