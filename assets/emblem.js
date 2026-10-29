// Emblème jnm.app : 128 pixels pilotés un par un qui se réassemblent en figures 2D et 3D.
// Spirale → sphère → cube → double hélice → tore → onde → icône « .APP » → spirale.
// Survol : les pixels s'écartent du curseur. Clic : figure suivante.
// Mouvement réduit (réglage du système) : même cycle, plus lent, sans traînées ni tourbillon.
(function () {
    'use strict';

    const host = document.querySelector('[data-emblem]');
    if (!host) return;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    host.append(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const N = 128;
    const INK = [29, 29, 31];
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const TAU = Math.PI * 2;

    // ---------- outils ----------

    const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
    const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const rotX = ([x, y, z], a) => [x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
    const rotY = ([x, y, z], a) => [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)];
    const rotZ = ([x, y, z], a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a), z];

    // ---------- figures : f(i, t) → [x, y, z] dans [-1, 1] ----------

    // Spirale personnelle, relevée sur le logo d'origine : 10 segments de traits (128 points au total)
    // qui, tracés épais à bouts ronds, redonnent exactement le dessin. Coordonnées / rayon du logo.
    const SPIRAL_WIDTH = 0.1219;
    const SPIRAL = [
        [[-0.238,-0.899],[-0.144,-0.906],[-0.051,-0.899],[0.041,-0.881],[0.128,-0.844],[0.209,-0.797],[0.283,-0.739],[0.348,-0.671],[0.403,-0.595],[0.455,-0.516],[0.493,-0.43],[0.525,-0.342],[0.55,-0.251],[0.562,-0.158],[0.588,-0.073]],
        [[0.02,-0.499],[-0.039,-0.572],[-0.13,-0.597],[-0.224,-0.608],[-0.32,-0.608],[-0.412,-0.587],[-0.503,-0.558],[-0.586,-0.512],[-0.662,-0.454],[-0.728,-0.386],[-0.785,-0.309],[-0.828,-0.225],[-0.861,-0.136],[-0.878,-0.042],[-0.879,0.053]],
        [[0.708,-0.582],[0.727,-0.49],[0.734,-0.397],[0.726,-0.304],[0.708,-0.212],[0.679,-0.123],[0.602,-0.073]],
        [[-0.099,0.066],[-0.069,0.142],[0.003,0.189],[0.088,0.205],[0.173,0.192],[0.25,0.153],[0.31,0.091],[0.351,0.015],[0.37,-0.069],[0.368,-0.156],[0.347,-0.24],[0.305,-0.316],[0.248,-0.38],[0.181,-0.436],[0.102,-0.473],[0.02,-0.499]],
        [[-0.578,0.066],[-0.559,-0.02],[-0.534,-0.104],[-0.497,-0.183],[-0.447,-0.255],[-0.386,-0.318],[-0.318,-0.373],[-0.241,-0.415],[-0.159,-0.446],[-0.072,-0.462],[0.007,-0.489]],
        [[0.106,-0.073],[0.076,-0.149],[0.004,-0.196],[-0.082,-0.205],[-0.169,-0.194],[-0.244,-0.151],[-0.302,-0.086],[-0.342,-0.009],[-0.357,0.076],[-0.356,0.164],[-0.332,0.247],[-0.289,0.323],[-0.232,0.389],[-0.163,0.443],[-0.084,0.478],[0.001,0.497]],
        [[0.595,-0.063],[0.572,0.031],[0.541,0.121],[0.493,0.205],[0.438,0.283],[0.371,0.352],[0.29,0.403],[0.201,0.441],[0.107,0.462],[0.02,0.489]],
        [[0.886,-0.046],[0.879,0.046],[0.864,0.137],[0.835,0.226],[0.792,0.308],[0.741,0.385],[0.678,0.453],[0.604,0.509],[0.521,0.552],[0.434,0.583],[0.343,0.599],[0.25,0.608],[0.158,0.6],[0.068,0.581],[0.013,0.509]],
        [[-0.578,0.066],[-0.66,0.115],[-0.69,0.204],[-0.707,0.297],[-0.714,0.391],[-0.708,0.486],[-0.681,0.575]],
        [[-0.569,0.079],[-0.542,0.158],[-0.53,0.245],[-0.51,0.33],[-0.484,0.414],[-0.449,0.494],[-0.408,0.572],[-0.358,0.644],[-0.301,0.711],[-0.236,0.77],[-0.165,0.821],[-0.085,0.858],[-0.003,0.887],[0.084,0.904],[0.171,0.905],[0.258,0.906]],
    ];
    const SPIRAL_PTS = SPIRAL.flat();
    const SPIRAL_START = SPIRAL.map((_, k) => SPIRAL.slice(0, k).reduce((n, s) => n + s.length, 0));
    function spiral(i, t) {
        const [x, y] = SPIRAL_PTS[i];
        const a = -t * 0.18; // lente rotation
        return [(x * Math.cos(a) - y * Math.sin(a)) * 0.95, (x * Math.sin(a) + y * Math.cos(a)) * 0.95, 0];
    }

    function sphere(i, t) {
        const y = 1 - (2 * (i + 0.5)) / N;
        const rad = Math.sqrt(1 - y * y);
        const phi = i * 2.399963;
        let p = [Math.cos(phi) * rad * 0.82, y * 0.82, Math.sin(phi) * rad * 0.82];
        p = rotY(p, t * 0.9);
        return rotX(p, 0.4);
    }

    // 8 sommets + 12 arêtes × 10 pixels = 128.
    const CUBE_V = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
    const CUBE_E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    function cube(i, t) {
        let p;
        if (i < 8) p = CUBE_V[i];
        else {
            const e = CUBE_E[Math.floor((i - 8) / 10)];
            const s = (((i - 8) % 10) + 1) / 11;
            const a = CUBE_V[e[0]], b = CUBE_V[e[1]];
            p = [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
        }
        p = p.map((v) => v * 0.5);
        p = rotY(p, t * 0.8);
        return rotX(p, 0.5 + t * 0.45);
    }

    function helix(i, t) {
        const strand = i < 64 ? 0 : Math.PI;
        const s = (i % 64) / 63;
        const a = s * 4 * Math.PI + t * 1.6 + strand;
        const p = [Math.cos(a) * 0.4, (s - 0.5) * 1.75, Math.sin(a) * 0.4];
        return rotZ(rotX(p, 0.25), 0.55);
    }

    function torus(i, t) {
        const a = ((i % 16) / 16) * TAU;
        const b = (Math.floor(i / 16) / 8) * TAU + t * 1.4;
        const R = 0.58, r = 0.25;
        let p = [(R + r * Math.cos(b)) * Math.cos(a), r * Math.sin(b), (R + r * Math.cos(b)) * Math.sin(a)];
        p = rotY(p, t * 0.6);
        return rotX(p, 1.05);
    }

    function wave(i, t) {
        const gx = i % 16, gz = Math.floor(i / 16);
        const x = (gx / 15 - 0.5) * 1.7;
        const z = (gz / 7 - 0.5) * 1.1;
        const y = 0.2 * Math.sin(x * 3.2 + t * 3.2) * Math.cos(z * 2.4 - t * 1.6);
        return rotX(rotY([x, y, z], Math.sin(t * 0.4) * 0.35), -0.95);
    }

    // Icône d'app : contour en squircle + « .APP » en police pixel 4×5, tout en pixels noirs.
    const GLYPHS = {
        '.': ['.', '.', '.', '.', '#'],
        A: ['.##.', '#..#', '####', '#..#', '#..#'],
        P: ['###.', '#..#', '###.', '#...', '#...'],
    };
    const TEXT = [];
    (() => {
        let col = 0;
        for (const ch of '.APP') {
            const g = GLYPHS[ch];
            g.forEach((row, y) => [...row].forEach((c, x) => { if (c === '#') TEXT.push([col + x, y, ch === '.']); }));
            col += g[0].length + 1;
        }
        const w = col - 1;
        for (const p of TEXT) { p[0] -= (w - 1) / 2; p[1] -= 2; }
    })();
    const PITCH = 0.085;
    function appIcon(i) {
        if (i < TEXT.length) return [TEXT[i][0] * PITCH, TEXT[i][1] * PITCH + 0.02, 0];
        const k = i - TEXT.length;
        const a = (k / (N - TEXT.length)) * TAU;
        const c = Math.cos(a), s = Math.sin(a);
        const r = 0.86;
        return [r * Math.sign(c) * Math.pow(Math.abs(c), 0.5), r * Math.sign(s) * Math.pow(Math.abs(s), 0.5), 0];
    }

    const scatter = Array.from({ length: N }, (_, i) => {
        const a = i * 2.399963, r = 1.6 + (i % 7) * 0.12;
        return [Math.cos(a) * r, Math.sin(a) * r, ((i % 5) - 2) * 0.4];
    });

    const PHASES = [
        { f: spiral, hold: 3.4, depth: 0 },
        { f: sphere, hold: 2.6, depth: 1 },
        { f: cube, hold: 2.6, depth: 1 },
        { f: helix, hold: 2.6, depth: 1 },
        { f: torus, hold: 2.6, depth: 1 },
        { f: wave, hold: 2.6, depth: 1 },
        { f: appIcon, hold: 3.2, depth: 0 },
    ];
    const MORPH = 1.25;
    const STAGGER = 0.4;

    // ---------- état ----------

    let dpr = 1, size = 0, unit = 0, cx = 0;
    let clock = 0, phase = 0, phaseStart = 0, from = null, last = performance.now();
    const push = Array.from({ length: N }, () => [0, 0, 0, 0]); // décalage x, y + vitesse
    const pointer = { x: 0, y: 0, active: false };

    function resize() {
        const box = host.getBoundingClientRect();
        dpr = Math.min(window.devicePixelRatio || 1, 3);
        const css = box.width * 1.8;
        canvas.style.width = canvas.style.height = `${css}px`;
        size = Math.round(css * dpr);
        canvas.width = canvas.height = size;
        cx = size / 2;
        unit = (box.width / 2) * dpr * 0.95;
    }

    function shapeAt(p, i, t) {
        return p === -1 ? scatter[i] : PHASES[p].f(i, t);
    }

    // ---------- rendu ----------

    function frame(now) {
        // Temps réel (plafonné au retour d'un onglet en arrière-plan) : une machine lente saute des images
        // mais l'animation garde sa vitesse.
        const dt = Math.min(0.25, Math.max(0, now - last) / 1000) * (reduce ? 0.6 : 1);
        last = now;
        clock += dt;

        const cur = PHASES[phase];
        let local = clock - phaseStart;
        if (local > MORPH + cur.hold) {
            from = phase;
            phase = (phase + 1) % PHASES.length;
            phaseStart = clock;
            local = 0;
        }
        const morph = clamp(local / MORPH);
        const next = PHASES[phase];
        const prev = from === null ? null : from === -1 ? null : PHASES[from];

        // Poids des rendus « pleins » (traits de la spirale, icône remplie).
        const settle = easeInOut(clamp((local - MORPH * 0.7) / (MORPH * 0.6)));
        const leaving = from !== null && from !== -1 ? 1 - easeInOut(clamp(local / (MORPH * 0.5))) : 0;
        const wSpiral = (next.f === spiral ? settle : 0) + (prev && prev.f === spiral ? leaving : 0);
        const wApp = (next.f === appIcon ? settle : 0) + (prev && prev.f === appIcon ? leaving : 0);
        const wDepth = (prev ? prev.depth * (1 - morph) : 0) + next.depth * morph;

        // Traînées : on efface partiellement l'image précédente.
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = `rgba(0, 0, 0, ${reduce ? 1 : 0.42})`;
        ctx.fillRect(0, 0, size, size);
        ctx.globalCompositeOperation = 'source-over';

        const pts = [];
        for (let i = 0; i < N; i++) {
            const delay = (i / N) * STAGGER;
            const k = easeInOut(clamp((local / MORPH - delay) / (1 - STAGGER)));
            const a = shapeAt(from === null ? phase : from, i, clock);
            const b = shapeAt(phase, i, clock);
            const burst = 1 + 0.38 * Math.sin(Math.PI * k) * (from === null || reduce ? 0 : 1);
            let p = [(a[0] + (b[0] - a[0]) * k) * burst, (a[1] + (b[1] - a[1]) * k) * burst, a[2] + (b[2] - a[2]) * k];
            if (!reduce && k > 0 && k < 1) p = rotZ(p, Math.sin(Math.PI * k) * 0.6);

            const persp = 2.8 / (2.8 - p[2]);
            let sx = cx + p[0] * unit * persp;
            let sy = cx + p[1] * unit * persp;

            // Répulsion du curseur, avec ressort.
            const q = push[i];
            if (pointer.active) {
                const dx = sx - pointer.x, dy = sy - pointer.y;
                const d2 = dx * dx + dy * dy, R = unit * 0.55;
                if (d2 < R * R) {
                    const f = (1 - Math.sqrt(d2) / R) * 2.4 * dpr;
                    const d = Math.sqrt(d2) || 1;
                    q[2] += (dx / d) * f;
                    q[3] += (dy / d) * f;
                }
            }
            q[2] += -q[0] * 0.12; q[3] += -q[1] * 0.12;
            q[2] *= 0.78; q[3] *= 0.78;
            q[0] += q[2]; q[1] += q[3];
            sx += q[0]; sy += q[1];

            pts.push({ i, x: sx, y: sy, z: p[2], persp });
        }

        if (wDepth > 0.01) pts.sort((u, v) => u.z - v.z);

        const base = Math.max(1.4 * dpr, unit * 0.072);
        for (const pt of pts) {
            const depth = wDepth * pt.z; // -1 (loin) … 1 (près)
            const alpha = 1 - wDepth * 0.55 * (1 - (pt.z + 1) / 2);
            const isText = pt.i < TEXT.length;
            // Texte .APP : pixels jointifs, comme une police bitmap.
            const s = (wApp > 0.5 && isText ? unit * PITCH * 1.02 : base) * (1 + 0.45 * depth);
            ctx.globalAlpha = clamp(alpha, 0.15, 1);
            ctx.fillStyle = `rgb(${INK})`;
            ctx.fillRect(pt.x - s / 2, pt.y - s / 2, s, s);
        }
        ctx.globalAlpha = 1;

        // Les pixels de la spirale fusionnent en traits épais, comme le logo d'origine.
        if (wSpiral > 0.01) {
            const byIndex = [];
            for (const pt of pts) byIndex[pt.i] = pt;
            ctx.save();
            ctx.globalAlpha = wSpiral;
            ctx.strokeStyle = `rgb(${INK})`;
            ctx.lineWidth = unit * SPIRAL_WIDTH * 0.95;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            SPIRAL.forEach((seg, k) => {
                ctx.beginPath();
                for (let j = 0; j < seg.length; j++) {
                    const pt = byIndex[SPIRAL_START[k] + j];
                    if (j) ctx.lineTo(pt.x, pt.y); else ctx.moveTo(pt.x, pt.y);
                }
                ctx.stroke();
            });
            ctx.restore();
        }

        // Barreaux de l'hélice.
        if (next.f === helix || (prev && prev.f === helix)) {
            const w = next.f === helix ? settle : leaving;
            const byIndex = [];
            for (const pt of pts) byIndex[pt.i] = pt;
            ctx.save();
            ctx.globalAlpha = w * 0.35;
            ctx.strokeStyle = `rgb(${INK})`;
            ctx.lineWidth = dpr;
            for (let j = 0; j < 64; j += 4) {
                ctx.beginPath();
                ctx.moveTo(byIndex[j].x, byIndex[j].y);
                ctx.lineTo(byIndex[j + 64].x, byIndex[j + 64].y);
                ctx.stroke();
            }
            ctx.restore();
        }

        requestAnimationFrame(frame);
    }

    // ---------- interactions ----------

    host.addEventListener('pointermove', (e) => {
        const r = canvas.getBoundingClientRect();
        pointer.x = (e.clientX - r.left) * dpr;
        pointer.y = (e.clientY - r.top) * dpr;
        pointer.active = true;
    });
    host.addEventListener('pointerleave', () => { pointer.active = false; });
    host.addEventListener('click', () => {
        // Saute directement à la figure suivante.
        phaseStart = clock - (MORPH + PHASES[phase].hold) - 0.001;
    });

    // Accès de test : host.jnmEmblem.show(n) affiche directement la figure n (0 = spirale).
    host.jnmEmblem = { show(n) { from = null; phase = n % PHASES.length; phaseStart = clock - MORPH - 0.6; } };

    window.addEventListener('resize', resize, { passive: true });
    resize();

    // Entrée : les pixels arrivent de l'extérieur ; en mouvement réduit, la spirale est là d'emblée.
    if (reduce) { from = null; phase = 0; phaseStart = -MORPH - 0.5; } else from = -1;
    requestAnimationFrame(frame);
})();
