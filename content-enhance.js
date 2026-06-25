(function () {
    'use strict';

    function initMermaid() {
        const blocks = document.querySelectorAll('.mermaid');
        if (blocks.length === 0 || typeof mermaid === 'undefined') return;

        mermaid.initialize({
            startOnLoad: false,
            theme: 'default',
            securityLevel: 'strict',
            flowchart: { htmlLabels: true },
        });

        mermaid.run({ nodes: blocks }).catch((error) => {
            console.warn('Mermaid rendering failed:', error);
        });
    }

    function initKatex() {
        if (typeof renderMathInElement === 'undefined') return;

        renderMathInElement(document.body, {
            delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: '\\[', right: '\\]', display: true },
                { left: '$', right: '$', display: false },
                { left: '\\(', right: '\\)', display: false },
            ],
            throwOnError: false,
        });
    }

    function init() {
        initMermaid();
        initKatex();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
