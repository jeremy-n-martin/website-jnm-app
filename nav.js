(function () {
    'use strict';

    const nav = document.getElementById('site-nav');
    if (!nav) return;

    const depth = Number(nav.dataset.depth || 0);
    const toRoot = depth > 0 ? '../'.repeat(depth) : '';

    function pageHref(slug) {
        return `${toRoot}pages/${slug}.html`;
    }

    function welcomeHref() {
        return `${toRoot}index.html`;
    }

    function isCurrentPage(slug) {
        const current = window.location.pathname.split('/').pop() || 'index.html';
        if (slug) return current === `${slug}.html`;
        return current === 'index.html' || current === '';
    }

    const staticPages = [
        { slug: null, label: 'Welcome', href: welcomeHref() },
    ];

    fetch(`${toRoot}pages.json`, { cache: 'no-cache' })
        .then((response) => (response.ok ? response.json() : []))
        .then((extraPages) => {
            const entries = staticPages.concat(
                (Array.isArray(extraPages) ? extraPages : []).map((page) => ({
                    slug: page.slug,
                    label: page.label || page.title || page.slug,
                    title: page.title,
                    href: pageHref(page.slug),
                }))
            );

            if (entries.length <= 1) return;

            const list = document.createElement('ul');
            for (const entry of entries) {
                const item = document.createElement('li');
                const link = document.createElement('a');
                link.href = entry.href;
                link.textContent = entry.label;
                if (entry.title) link.title = entry.title;
                if (isCurrentPage(entry.slug)) {
                    link.setAttribute('aria-current', 'page');
                }
                item.appendChild(link);
                list.appendChild(item);
            }
            nav.appendChild(list);
        })
        .catch(() => {});
})();
