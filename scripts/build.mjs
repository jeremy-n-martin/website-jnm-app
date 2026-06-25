import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(SCRIPTS_DIR);
const CONTENT_DIR = join(ROOT, 'content');
const PAGES_DIR = join(ROOT, 'pages');
const TEMPLATE_PATH = join(ROOT, 'templates', 'page.html');
const PAGES_JSON_PATH = join(ROOT, 'pages.json');

const PAGE_ORDER = [
    'loop-theorie',
    'loop-claude',
    'loop-hermes',
    'loop-openclaw',
];

const NAV_LABELS = {
    'loop-theorie': 'Théorie',
    'loop-claude': 'Claude',
    'loop-hermes': 'Hermes',
    'loop-openclaw': 'OpenClaw',
};

const renderer = new marked.Renderer();
renderer.code = function ({ text, lang }) {
    if (lang === 'mermaid') {
        return `<div class="mermaid">${text}</div>\n`;
    }
    const language = lang ? ` class="language-${lang}"` : '';
    return `<pre><code${language}>${escapeHtml(text)}</code></pre>\n`;
};

marked.use({
    gfm: true,
    breaks: false,
    renderer,
});

function parseFrontmatter(raw) {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) {
        return { meta: {}, body: raw };
    }

    const meta = {};
    for (const line of match[1].split('\n')) {
        if (/^\s/.test(line)) continue;
        const trimmed = line.trim();
        if (!trimmed || !trimmed.includes(':')) continue;
        const colon = trimmed.indexOf(':');
        const key = trimmed.slice(0, colon).trim();
        const value = trimmed.slice(colon + 1).trim().replace(/^["']|["']$/g, '');
        if (value) meta[key] = value;
    }
    return { meta, body: match[2] };
}

function extractTitle(markdown, meta) {
    if (meta.title) return meta.title;
    const match = markdown.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : 'Untitled';
}

function navLabel(slug, meta, title) {
    if (meta.navLabel) return meta.navLabel;
    if (NAV_LABELS[slug]) return NAV_LABELS[slug];
    return title;
}

function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function buildPage(markdown, template) {
    const { meta, body } = parseFrontmatter(markdown);
    const title = extractTitle(body, meta);
    const description = meta.description || `${title} — Jeremy N. Martin`;
    const htmlContent = marked.parse(body);

    return template
        .replace('{{TITLE}}', escapeHtml(title))
        .replace('{{DESCRIPTION}}', escapeHtml(description))
        .replace('{{CONTENT}}', htmlContent);
}

function sortFiles(files) {
    return [...files].sort((a, b) => {
        const slugA = basename(a, '.md');
        const slugB = basename(b, '.md');
        const indexA = PAGE_ORDER.indexOf(slugA);
        const indexB = PAGE_ORDER.indexOf(slugB);
        const rankA = indexA === -1 ? PAGE_ORDER.length : indexA;
        const rankB = indexB === -1 ? PAGE_ORDER.length : indexB;
        if (rankA !== rankB) return rankA - rankB;
        return slugA.localeCompare(slugB);
    });
}

function main() {
    if (!existsSync(CONTENT_DIR)) {
        console.log('No content/ directory found.');
        return;
    }

    const mdFiles = sortFiles(
        readdirSync(CONTENT_DIR).filter((f) => extname(f) === '.md' && f !== 'README.md')
    );

    if (mdFiles.length === 0) {
        writeFileSync(PAGES_JSON_PATH, '[]\n');
        console.log('No markdown files to build. pages.json cleared.');
        return;
    }

    if (!existsSync(PAGES_DIR)) {
        mkdirSync(PAGES_DIR, { recursive: true });
    }

    const template = readFileSync(TEMPLATE_PATH, 'utf-8');
    const navEntries = [];

    for (const file of mdFiles) {
        const slug = basename(file, '.md');
        const markdown = readFileSync(join(CONTENT_DIR, file), 'utf-8');
        const { meta, body } = parseFrontmatter(markdown);
        const title = extractTitle(body, meta);
        const outputPath = join(PAGES_DIR, `${slug}.html`);

        writeFileSync(outputPath, buildPage(markdown, template));
        navEntries.push({
            slug,
            label: navLabel(slug, meta, title),
            title,
        });
        console.log(`Built pages/${slug}.html`);
    }

    writeFileSync(PAGES_JSON_PATH, JSON.stringify(navEntries, null, 2) + '\n');
    console.log(`Updated pages.json (${navEntries.length} page(s)).`);
}

main();
