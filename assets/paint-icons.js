// Icônes peintes de l'accueil : chaque icône compte exactement 128 touches de peinture, posées une à une
// à la main sur une grille de 20 × 20 (calque « fond » en 10 × 10 ; motif dessiné case par case en
// 20 × 20, ou en traits relevés sur un logo, avec le nombre de touches de chaque trait).
// Rendu : fond dégradé, touches à relief (ombre, corps, éclat, traces de poils), grain de toile,
// vernis ancien, reflet moderne. Survol : coup de pinceau qui repasse sur l'icône + mouvement propre.
// Tout se règle par icône dans ICONS (couleurs, rôles des touches, pinceau, mouvement).
(function () {
    'use strict';

    const N = 128;
    const TAU = Math.PI * 2;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ---------- outils ----------

    const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
    const hex = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
    const mix = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
    const WHITE = [255, 250, 240];
    const UMBER = [24, 16, 10];
    // k > 0 éclaircit (vers un blanc chaud), k < 0 assombrit (vers une terre d'ombre).
    const tone = (c, k) => (k >= 0 ? mix(c, WHITE, k) : mix(c, UMBER, -k));
    const css = (c, a = 1) => `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${a})`;
    const easeOutBack = (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
    // Hasard reproductible : une même touche garde toujours sa forme.
    function rand(seed) {
        let s = seed >>> 0;
        return () => {
            s = (s + 0x6d2b79f5) >>> 0;
            let t = s;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // ---------- les icônes ----------
    // motif : 20 lignes de 20 caractères, une lettre = une touche (son rôle), « . » = vide.
    // fond : 10 lignes de 10 caractères, « ~ » = une grande touche de fond.
    // fond + motif = 128 touches, vérifié au chargement.

    const ICONS = {
        linkedin: {
            tile: '#1f5ea8',
            brush: -0.75,
            roles: { d: { color: '#f6ecd6' }, i: { color: '#f4ead2' }, n: { color: '#f4ead2' } },
            motif: [
                '....................',
                '....................',
                '....................',
                '....ddd.............',
                '....ddd.............',
                '....ddd.............',
                '....................',
                '....iii.nnn.nnn.....',
                '....iii.nnnnnnnn....',
                '....iii.nnnn.nnn....',
                '....iii.nnn..nnn....',
                '....iii.nnn..nnn....',
                '....iii.nnn..nnn....',
                '....iii.nnn..nnn....',
                '....iii.nnn..nnn....',
                '....iii.nnn..nnn....',
                '....................',
                '....................',
                '....................',
                '....................',
            ],
            fond: [
                '~..~..~..~',
                '.~..~..~..',
                '..~..~..~.',
                '~..~..~..~',
                '.~..~..~.~',
                '..~..~..~.',
                '~..~..~..~',
                '.~..~..~..',
                '..~..~..~.',
                '~..~..~..~',
            ],
            // Les lettres ondulent, le point du i saute.
            move(p, k) {
                if (p.role === 'd') {
                    const hop = Math.abs(Math.sin(k.t * 5.2));
                    p.y -= hop * 1.7 * k.h;
                    p.wid *= 1 - 0.18 * k.h * (1 - hop);
                } else if (p.role !== '~') {
                    p.y -= Math.sin(k.t * 7 - p.gx * 0.55) * 0.32 * k.h;
                }
            },
        },

        jeux: {
            tile: '#c4432b',
            brush: -0.55,
            roles: {
                o: { color: '#f6e9cf' },
                p: { color: '#6e1f13', round: true },
                a: { color: '#efb441', size: 1.35, round: true },
                b: { color: '#2c7f86', size: 1.35, round: true },
            },
            motif: [
                '....................',
                '....................',
                '....................',
                '....................',
                '....................',
                '....oooooooooooo....',
                '...oooooooooooooo...',
                '...ooopoooooooooo...',
                '...oopppooooaoboo...',
                '...ooopoooooooooo...',
                '...oooooooooooooo...',
                '...ooooo....ooooo...',
                '...oooo......oooo...',
                '...ooo........ooo...',
                '....o..........o....',
                '....................',
                '....................',
                '....................',
                '....................',
                '....................',
            ],
            fond: [
                '..~....~..',
                '~....~....',
                '...~....~.',
                '.~....~...',
                '....~....~',
                '~..~......',
                '......~..~',
                '.~...~....',
                '...~....~.',
                '~....~....',
            ],
            // La manette se balance, la croix s'enfonce, les boutons s'allument tour à tour.
            move(p, k) {
                if (p.role === '~') return;
                const a = Math.sin(k.t * 5) * 0.13 * k.h;
                rotateAround(p, a, 10, 10);
                p.y -= Math.abs(Math.sin(k.t * 5)) * 0.35 * k.h;
                if (p.role === 'p') p.scale *= 1 - 0.28 * k.h * Math.max(0, Math.sin(k.t * 9));
                if (p.role === 'a') p.light += 0.4 * k.h * Math.max(0, Math.sin(k.t * 7));
                if (p.role === 'b') p.light += 0.4 * k.h * Math.max(0, -Math.sin(k.t * 7));
            },
        },

        cabinetduplateau: {
            tile: '#56744f',
            brush: 0.6,
            roles: {
                l: { color: '#bcd1a6', leaf: true },
                g: { color: '#e3a640', size: 1.05, round: true },
                c: { color: '#f5eedb', size: 0.78 },
                p: { color: '#f5eedb', size: 0.78 },
            },
            motif: [
                '....................',
                '....................',
                '.......g....g.......',
                '.....lll....lll.....',
                '....lll......lll....',
                '...lll........lll...',
                '...ll..........ll...',
                '..ll..ccc..ppp..ll..',
                '..ll.c.....p..p.ll..',
                '..gl.c.....p..p.lg..',
                '..ll.c.....ppp..ll..',
                '..ll.c.....p....ll..',
                '..ll..ccc..p....ll..',
                '...ll..........ll...',
                '...lll........lll...',
                '....gll......llg....',
                '.....lll....lll.....',
                '....................',
                '....................',
                '....................',
            ],
            fond: [
                '~..~..~..~',
                '.~..~..~.~',
                '..~..~..~.',
                '~..~..~..~',
                '.~..~..~.~',
                '..~..~..~.',
                '~..~..~..~',
                '.~..~..~..',
                '..~..~..~.',
                '~..~..~..~',
            ],
            // La couronne frémit comme sous le vent, les baies scintillent.
            move(p, k) {
                if (p.role === 'l' || p.role === 'g') {
                    rotateAround(p, Math.sin(k.t * 1.8) * 0.22 * k.h, 10, 10);
                    p.ang += Math.sin(k.t * 6 + p.i) * 0.35 * k.h;
                    if (p.role === 'g') p.light += 0.35 * k.h * (0.5 + 0.5 * Math.sin(k.t * 8 + p.i * 2));
                } else if (p.role !== '~') {
                    p.scale *= 1 + 0.06 * k.h * Math.sin(k.t * 3);
                }
            },
        },

        metamachia: {
            tile: '#4b3482',
            brush: -0.9,
            roles: {
                m: { color: '#efe5f6' },
                n: { color: '#f2c45a', size: 1.2, round: true },
                s: { color: '#cdb8ea', size: 0.55, round: true },
            },
            motif: [
                '....................',
                '.s.......s........s.',
                '......s......s......',
                '..s..............s..',
                '....nmm......mmn....',
                '....mmmm....mmmm....',
                '....mm.mm..mm.mm....',
                '....mm..mmmm..mm....',
                '....mm...mm...mm....',
                '.s..mm...nn...mm..s.',
                '....mm........mm....',
                '....mm.s....s.mm....',
                '..s.mm...s....mm.s..',
                '....mm.s....s.mm....',
                '....mm...ss...mm....',
                '....nm........mn....',
                '......s......s......',
                '..s......s.......s..',
                '....................',
                '....................',
            ],
            fond: [
                '~..~..~..~',
                '.~..~..~.~',
                '~.~..~..~.',
                '~..~..~..~',
                '.~..~..~.~',
                '~.~..~..~.',
                '~..~..~..~',
                '.~..~..~.~',
                '..~..~..~.',
                '~..~..~..~',
            ],
            // Le M devient un système vivant : chaque touche orbite, les satellites tournent,
            // le réseau qui relie les nœuds s'allume.
            move(p, k) {
                if (p.role === 'm') {
                    p.x += Math.cos(k.t * 3.1 + p.i * 1.7) * 0.42 * k.h;
                    p.y += Math.sin(k.t * 2.7 + p.i * 1.3) * 0.42 * k.h;
                } else if (p.role === 's') {
                    rotateAround(p, k.h * (Math.sin(k.t * 0.9) * 0.9 + (p.i % 2 ? 0.25 : -0.25)), 10, 10);
                } else if (p.role === 'n') {
                    p.scale *= 1 + 0.3 * k.h * (0.5 + 0.5 * Math.sin(k.t * 6 + p.i));
                    p.light += 0.25 * k.h;
                }
            },
            // Fils du réseau entre nœuds et satellites voisins.
            after(ctx, pts, k, c) {
                const nodes = pts.filter((p) => p.role === 'n' || p.role === 's');
                ctx.lineWidth = Math.max(0.6, c * 0.12);
                ctx.lineCap = 'round';
                for (let a = 0; a < nodes.length; a++) {
                    for (let b = a + 1; b < nodes.length; b++) {
                        const dx = nodes[a].x - nodes[b].x, dy = nodes[a].y - nodes[b].y;
                        const d = Math.hypot(dx, dy);
                        if (d > 5.2) continue;
                        ctx.strokeStyle = css(hex('#f2c45a'), (0.16 + 0.42 * k.h) * (1 - d / 5.2) * k.appear);
                        ctx.beginPath();
                        ctx.moveTo(nodes[a].x * c, nodes[a].y * c);
                        ctx.lineTo(nodes[b].x * c, nodes[b].y * c);
                        ctx.stroke();
                    }
                }
            },
            lines: 'before',
        },

        // Bestiaire : le dragon dans son hexagone, relevé sur le logo (repère 64 × 64).
        // Ici le motif est fait de traits : chaque trait reçoit à la main son nombre de touches,
        // réparties le long du tracé et couchées dans son sens, comme la spirale de l'emblème.
        fantasiafauna: {
            tile: '#211c26',
            brush: -0.4,
            touch: 0.82,
            roles: {
                h: { color: '#a8873f', size: 0.8, stretch: 1.5 },
                d: { color: '#e2b250' },
                c: { color: '#e9bd5e' },
                y: { color: '#e0573a', size: 0.9, round: true },
                s: { color: '#c79a44' },
                w: { color: '#d9a548' },
            },
            frame: (x, y) => [3 + (x - 7) * 0.28, 1.9 + (y - 3) * 0.28],
            strokes: [
                // hexagone (36 touches)
                { role: 'h', n: 36, closed: true, path: [[32, 3], [57, 17], [57, 47], [32, 61], [7, 47], [7, 17]] },
                // corps, cou et tête (40)
                { role: 'd', n: 40, path: [[18, 43], [20, 29], [28, 20], [26, 11], [37, 20], [47, 22], [42, 29], [32, 31], [38, 37], [34, 47], [19, 47], [14, 41], [23, 42], [27, 35]] },
                // corne (6)
                { role: 'c', n: 6, path: [[32, 20], [35, 11], [40, 21]] },
                // œil (2)
                { role: 'y', n: 2, path: [[38, 25], [41, 25]] },
                // sol (7)
                { role: 's', n: 7, path: [[18, 51], [46, 51]] },
                // aile (7)
                { role: 'w', n: 7, path: [[43, 34], [50, 31], [47, 39], [41, 43]] },
            ],
            fond: [
                '~..~..~..~',
                '.~.....~..',
                '..~..~..~.',
                '~..~..~..~',
                '.~.....~..',
                '..~..~..~.',
                '~..~..~..~',
                '.~.....~..',
                '..~..~..~.',
                '~.....~..~',
            ],
            // Le dragon respire et se redresse, l'aile bat, l'œil rougeoie, l'hexagone tourne doucement.
            move(p, k) {
                if (p.role === '~') return;
                if (p.role === 'h') {
                    rotateAround(p, Math.sin(k.t * 1.4) * 0.12 * k.h, 10, 10);
                    p.light += 0.25 * k.h;
                    return;
                }
                if (p.role === 's') return;
                const breath = Math.sin(k.t * 3.4);
                p.y -= (0.3 + 0.3 * breath) * k.h;
                if (p.role === 'w') {
                    const [ox, oy] = this.frame(43, 34);
                    rotateAround(p, -Math.max(0, Math.sin(k.t * 7)) * 0.55 * k.h, ox, oy);
                }
                if (p.role === 'y') p.light += 0.5 * k.h * (0.6 + 0.4 * breath);
            },
        },
    };

    function rotateAround(p, a, ox, oy) {
        const dx = p.x - ox, dy = p.y - oy;
        const c = Math.cos(a), s = Math.sin(a);
        p.x = ox + dx * c - dy * s;
        p.y = oy + dx * s + dy * c;
        p.ang += a;
    }

    // ---------- préparation des touches ----------

    const GRID = 20;

    function build(name, def, seed) {
        const tile = hex(def.tile);
        const pts = [];
        // Calque du fond : grandes touches dans la couleur de l'icône, un ton plus clair ou plus sombre.
        def.fond.forEach((row, r) => [...row].forEach((ch, col) => {
            if (ch !== '~') return;
            const rnd = rand(seed * 7919 + pts.length * 104729 + 1);
            const shade = [0.2, -0.16, 0.1, -0.26, 0.15, -0.08][pts.length % 6] + (rnd() - 0.5) * 0.1;
            pts.push({
                role: '~',
                gx: col * 2 + 1 + (rnd() - 0.5) * 1.3,
                gy: r * 2 + 1 + (rnd() - 0.5) * 1.3,
                len: 4.4 + rnd() * 1.8,
                wid: 1.9 + rnd() * 0.6,
                ang: def.brush + (rnd() - 0.5) * 0.6,
                color: tone(tile, shade),
                alpha: 0.62 + rnd() * 0.2,
            });
        }));
        // Calque du motif : une touche par lettre, avec son rôle.
        (def.motif ?? []).forEach((row, r) => [...row].forEach((ch, col) => {
            if (ch === '.') return;
            const role = def.roles[ch];
            if (!role) return;
            const rnd = rand(seed * 7919 + pts.length * 104729 + 7);
            const gx = col + 0.5 + (rnd() - 0.5) * 0.26;
            const gy = r + 0.5 + (rnd() - 0.5) * 0.26;
            // Les feuilles suivent le cercle de la couronne ; le reste suit le geste général du pinceau.
            const ang = role.leaf
                ? Math.atan2(gy - 10, gx - 10) + Math.PI / 2 + (pts.length % 2 ? 0.5 : -0.5)
                : def.brush + (rnd() - 0.5) * 0.8;
            // touch : taille des touches de toute l'icône ; size : celle d'un rôle ; round : touche ronde.
            const size = (role.size ?? 1) * (def.touch ?? 1);
            const wid = (role.leaf ? 1 : 1.15 + rnd() * 0.15) * size;
            pts.push({
                role: ch,
                gx, gy,
                len: role.round ? wid * 1.05 : (role.leaf ? 2.05 : 1.7 + rnd() * 0.35) * size,
                wid,
                ang,
                color: tone(hex(role.color), (rnd() - 0.5) * 0.14),
                alpha: 0.96,
            });
        }));
        // Calque du motif en traits : n touches réparties le long de chaque tracé, dans son sens.
        for (const st of def.strokes ?? []) {
            const role = def.roles[st.role];
            const path = st.path.map(([x, y]) => def.frame(x, y));
            if (st.closed) path.push(path[0]);
            const seg = [];
            let total = 0;
            for (let s = 1; s < path.length; s++) {
                const l = Math.hypot(path[s][0] - path[s - 1][0], path[s][1] - path[s - 1][1]);
                seg.push(l);
                total += l;
            }
            for (let j = 0; j < st.n; j++) {
                let d = (st.closed ? j / st.n : j / Math.max(1, st.n - 1)) * total;
                let s = 0;
                while (s < seg.length - 1 && d > seg[s]) { d -= seg[s]; s++; }
                const [ax, ay] = path[s], [bx, by] = path[s + 1];
                const u = seg[s] ? d / seg[s] : 0;
                const rnd = rand(seed * 7919 + pts.length * 104729 + 13);
                const size = (role.size ?? 1) * (def.touch ?? 1);
                const wid = (1.05 + rnd() * 0.15) * size;
                pts.push({
                    role: st.role,
                    gx: ax + (bx - ax) * u + (rnd() - 0.5) * 0.15,
                    gy: ay + (by - ay) * u + (rnd() - 0.5) * 0.15,
                    len: role.round ? wid * 1.05 : (1.75 + rnd() * 0.3) * size * (role.stretch ?? 1),
                    wid,
                    ang: Math.atan2(by - ay, bx - ax) + (rnd() - 0.5) * 0.3,
                    color: tone(hex(role.color), (rnd() - 0.5) * 0.14),
                    alpha: 0.96,
                });
            }
        }
        if (pts.length !== N) console.warn(`paint-icons: « ${name} » a ${pts.length} touches au lieu de ${N}.`);
        pts.forEach((p, i) => { p.i = i; p.diag = (p.gx + p.gy) / (2 * GRID); });
        return { def, tile, pts };
    }

    // Grain de toile et craquelures, tirés une fois pour chaque taille.
    const grainCache = new Map();
    function grain(S) {
        if (grainCache.has(S)) return grainCache.get(S);
        const g = document.createElement('canvas');
        g.width = g.height = S;
        const x = g.getContext('2d');
        const img = x.createImageData(S, S);
        const rnd = rand(S * 31);
        for (let k = 0; k < S * S; k++) {
            const px = k % S, py = (k / S) | 0;
            // Trame de toile (fils croisés) + bruit.
            const weave = ((px % 3 === 0) ^ (py % 3 === 0)) ? 18 : -6;
            const v = 128 + weave + (rnd() - 0.5) * 70;
            img.data.set([v, v, v, 255], k * 4);
        }
        x.putImageData(img, 0, 0);
        // Craquelures du vernis.
        x.strokeStyle = 'rgba(40, 28, 18, 0.55)';
        x.lineWidth = Math.max(0.5, S / 140);
        for (let n = 0; n < 9; n++) {
            let px = rnd() * S, py = rnd() * S, a = rnd() * TAU;
            x.beginPath();
            x.moveTo(px, py);
            for (let s = 0; s < 4; s++) {
                a += (rnd() - 0.5) * 1.4;
                px += Math.cos(a) * S * 0.07;
                py += Math.sin(a) * S * 0.07;
                x.lineTo(px, py);
            }
            x.stroke();
        }
        grainCache.set(S, g);
        return g;
    }

    // ---------- rendu ----------

    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    function ellipse(ctx, x, y, rx, ry, a) {
        ctx.beginPath();
        ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), a, 0, TAU);
        ctx.fill();
    }

    // Une touche se peint en trois passes, chacune pour toutes les touches d'un calque :
    // 0 = ombre portée (le relief de la pâte), 1 = corps + seconde couche + poils, 2 = éclat de lumière.
    function dab(ctx, p, c, pass) {
        const x = p.x * c, y = p.y * c;
        const rx = (p.len * p.scale * c) / 2, ry = (p.wid * p.scale * c) / 2;
        if (rx < 0.2) return;
        const col = p.light ? tone(p.color, clamp(p.light, -1, 0.8)) : p.color;
        const a = p.alpha * p.fade;

        if (pass === 0) {
            ctx.fillStyle = css(tone(col, -0.7), 0.42 * a);
            ellipse(ctx, x + c * 0.2, y + c * 0.26, rx * 1.04, ry * 1.08, p.ang);
            return;
        }
        if (pass === 2) {
            ctx.fillStyle = css(tone(col, 0.55), 0.6 * a);
            ellipse(ctx, x - c * 0.16 - Math.cos(p.ang) * rx * 0.15, y - c * 0.2, rx * 0.5, ry * 0.26, p.ang);
            return;
        }
        ctx.fillStyle = css(col, a);
        ellipse(ctx, x, y, rx, ry, p.ang);
        // Seconde couche plus sombre vers le bout de la touche : la pâte s'épuise.
        ctx.fillStyle = css(tone(col, -0.12), a * 0.5);
        ellipse(ctx, x + Math.cos(p.ang) * rx * 0.3, y + Math.sin(p.ang) * rx * 0.3, rx * 0.6, ry * 0.72, p.ang);
        if (c >= 2.5) {
            // Poils du pinceau : fines traînées dans le sens de la touche.
            const ca = Math.cos(p.ang), sa = Math.sin(p.ang);
            ctx.lineWidth = Math.max(0.5, c * 0.08);
            for (const [off, k] of [[-0.55, 0.22], [-0.1, -0.16], [0.4, 0.12]]) {
                const ox = -sa * ry * off, oy = ca * ry * off;
                ctx.strokeStyle = css(tone(col, k), a * 0.55);
                ctx.beginPath();
                ctx.moveTo(x + ox - ca * rx * 0.82, y + oy - sa * rx * 0.82);
                ctx.lineTo(x + ox + ca * rx * 0.7, y + oy + sa * rx * 0.7);
                ctx.stroke();
            }
        }
    }

    function layer(ctx, pts, c, ground) {
        const list = pts.filter((p) => (p.role === '~') === ground);
        for (const pass of ground ? [1] : [0, 1, 2]) for (const p of list) dab(ctx, p, c, pass);
    }

    // Vie propre à chaque touche au survol, en plus du mouvement de l'icône. Une onde parcourt la peinture :
    // les touches voisines bougent ensemble (le dessin reste lisible), chacune avec un petit écart à elle,
    // son pinceau qui frémit, et à l'arrivée du curseur un écart du centre qui revient en place.
    function brushLife(p, k) {
        const ground = p.role === '~';
        const wave = p.gx * 0.62 + p.gy * 0.41;
        const phi = p.i * 2.399963;
        const amp = (ground ? 1 : 0.55) * k.h;
        const own = (ground ? 0.4 : 0.2) * k.h;
        p.x += Math.sin(k.t * 3.1 - wave) * amp + Math.cos(k.t * 4.7 + phi) * own;
        p.y += Math.cos(k.t * 2.6 - wave * 1.2) * amp * 0.8 + Math.sin(k.t * 5.3 + phi) * own;
        p.ang += Math.sin(k.t * 4.3 - wave + phi * 0.3) * 0.22 * k.h;
        if (p.len > p.wid * 1.2) p.len *= 1 + 0.16 * k.h * Math.sin(k.t * 5.1 - wave);
        p.scale *= 1 + 0.1 * k.h * Math.sin(k.t * 3.7 - wave * 0.8);
        const dx = p.x - GRID / 2, dy = p.y - GRID / 2, d = Math.hypot(dx, dy) || 1;
        const burst = 1.5 * k.h * Math.exp(-k.t * 3.8) * Math.min(1, k.t * 10);
        p.x += (dx / d) * burst;
        p.y += (dy / d) * burst;
    }

    function render(icon, ctx, S, k) {
        const { def, tile, pts } = icon;
        const c = S / GRID;
        const r = S * 0.22;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, S, S);
        ctx.save();
        roundRect(ctx, 0, 0, S, S, r);
        ctx.clip();

        // Fond : dégradé de clair-obscur.
        const base = ctx.createLinearGradient(0, 0, S, S);
        base.addColorStop(0, css(tone(tile, 0.16)));
        base.addColorStop(0.55, css(tile));
        base.addColorStop(1, css(tone(tile, -0.3)));
        ctx.fillStyle = base;
        ctx.fillRect(0, 0, S, S);

        // Position animée de chaque touche.
        const sweepW = k.sweep * 1.6 - 0.3;
        const live = pts.map((q) => {
            const p = { ...q, x: q.gx, y: q.gy, scale: 1, light: 0, fade: 1 };
            if (k.intro < 1) {
                const t = clamp((k.intro * 1.6 - q.diag - (q.role === '~' ? 0 : 0.25)) / 0.3);
                p.scale *= t > 0 ? easeOutBack(t) : 0;
                p.fade = clamp(t * 2);
            }
            if (k.sweep > 0 && k.sweep < 1) {
                const pulse = Math.exp(-Math.pow((q.diag - sweepW) / 0.1, 2));
                p.scale *= 1 + 0.45 * pulse;
                p.ang += 0.55 * pulse;
                p.light += 0.2 * pulse;
            }
            if (k.h > 0.001) {
                if (def.move) def.move(p, k);
                brushLife(p, k);
            }
            return p;
        });

        layer(ctx, live, c, true);
        if (def.after && def.lines === 'before') def.after(ctx, live, k, c);
        layer(ctx, live, c, false);
        if (def.after && def.lines !== 'before') def.after(ctx, live, k, c);

        // Grain de toile (lumière douce), puis vernis ambré sur les bords.
        ctx.globalCompositeOperation = 'soft-light';
        ctx.globalAlpha = 0.55;
        ctx.drawImage(grain(S), 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'multiply';
        const varnish = ctx.createRadialGradient(S * 0.42, S * 0.38, S * 0.15, S * 0.5, S * 0.5, S * 0.78);
        varnish.addColorStop(0, 'rgba(255, 236, 200, 0.9)');
        varnish.addColorStop(1, 'rgba(120, 78, 32, 0.9)');
        ctx.globalAlpha = 0.32;
        ctx.fillStyle = varnish;
        ctx.fillRect(0, 0, S, S);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';

        // Reflet net en haut, comme une plaque de verre.
        const gloss = ctx.createLinearGradient(0, 0, 0, S * 0.55);
        gloss.addColorStop(0, `rgba(255, 255, 255, ${0.2 + 0.08 * k.h})`);
        gloss.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = gloss;
        ctx.fillRect(0, 0, S, S * 0.55);
        ctx.restore();

        // Liseré : clair dedans, sombre dehors.
        const lw = Math.max(1, S / 80);
        ctx.lineWidth = lw;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
        roundRect(ctx, lw * 1.5, lw * 1.5, S - lw * 3, S - lw * 3, r - lw * 1.5);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(20, 12, 6, 0.3)';
        roundRect(ctx, lw / 2, lw / 2, S - lw, S - lw, r - lw / 2);
        ctx.stroke();
    }

    // ---------- mise en place ----------

    const hosts = document.querySelectorAll('[data-paint-icon]');
    hosts.forEach((host, index) => {
        const def = ICONS[host.dataset.paintIcon];
        if (!def) return;
        const canvas = document.createElement('canvas');
        canvas.setAttribute('aria-hidden', 'true');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        host.append(canvas);
        const icon = build(host.dataset.paintIcon, def, index + 1);

        let S = 0;
        const k = { h: 0, t: 0, sweep: 1, intro: reduce ? 1 : 0, appear: reduce ? 1 : 0 };
        let target = 0, running = false, last = 0, introDelay = index * 0.12;

        function resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 3);
            const size = Math.max(16, Math.round(host.getBoundingClientRect().width * dpr));
            if (size === S) return false;
            S = canvas.width = canvas.height = size;
            return true;
        }

        function draw() { render(icon, ctx, S, k); }

        function tick(now) {
            const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
            last = now;
            if (introDelay > 0) introDelay -= dt;
            else if (k.intro < 1) k.intro = Math.min(1, k.intro + dt / 1.1);
            k.appear = k.intro;
            k.h += (target - k.h) * (1 - Math.exp(-dt * 7));
            if (Math.abs(target - k.h) < 0.002) k.h = target;
            if (k.h > 0) k.t += dt;
            if (k.sweep < 1) k.sweep = Math.min(1, k.sweep + dt / 0.8);
            draw();
            if (k.intro < 1 || k.sweep < 1 || k.h !== target || target > 0) requestAnimationFrame(tick);
            else { running = false; if (target === 0) k.t = 0; }
        }

        // Mouvement réduit : pas d'entrée animée, mais le survol (voulu par l'utilisateur) reste animé.
        function wake() {
            if (running) return;
            running = true;
            last = performance.now();
            requestAnimationFrame(tick);
        }

        function enter() {
            if (target === 1) return;
            target = 1;
            if (k.h < 0.3) k.sweep = 0;
            wake();
        }
        function leave() { target = 0; wake(); }

        const card = host.closest('a, button') ?? host;
        card.addEventListener('pointerenter', enter);
        card.addEventListener('pointerleave', leave);
        card.addEventListener('focusin', enter);
        card.addEventListener('focusout', leave);

        window.addEventListener('resize', () => { if (resize() && !running) draw(); }, { passive: true });
        resize();
        draw();
        host.classList.add('is-painted');
        wake();

        // Accès de test : host.jnmPaint.pose(h, t) fige l'icône dans un état de survol donné.
        host.jnmPaint = {
            pose(h, t) { target = k.h = h; k.t = t; k.intro = 1; k.appear = 1; k.sweep = 1; draw(); },
            count: icon.pts.length,
        };
    });

    window.jnmPaintIcons = ICONS;
})();
