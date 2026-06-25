(function () {
    'use strict';

    const canvas = document.getElementById('plexus-canvas');
    if (!canvas) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
        canvas.remove();
        return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
        canvas.remove();
        return;
    }

    const MAX_PARTICLES = 150;
    const CONNECTION_DISTANCE = 100;
    const MOUSE_RADIUS = 150;
    const PARTICLE_COLOR = '#FFFFFF';

    let particles = [];
    let animationId = null;
    let isVisible = !document.hidden;

    const mouse = { x: null, y: null };

    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }

    function createParticle() {
        return {
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            size: Math.random() * 5 + 1,
            speedX: Math.random() * 3 - 1.5,
            speedY: Math.random() * 3 - 1.5,
        };
    }

    function initParticles() {
        const count = Math.min(
            MAX_PARTICLES,
            Math.floor((canvas.width * canvas.height) / 9000)
        );
        particles = Array.from({ length: count }, createParticle);
    }

    function updateParticle(particle) {
        if (particle.x > canvas.width || particle.x < 0) particle.speedX *= -1;
        if (particle.y > canvas.height || particle.y < 0) particle.speedY *= -1;
        particle.x += particle.speedX;
        particle.y += particle.speedY;
    }

    function drawParticle(particle) {
        ctx.fillStyle = PARTICLE_COLOR;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        ctx.fill();
    }

    function drawConnection(x1, y1, x2, y2, maxDistance) {
        const dx = x1 - x2;
        const dy = y1 - y2;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance >= maxDistance) return;

        const t = distance / maxDistance;
        const opacity = 1 - t * t * t;
        ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    }

    function connectParticles() {
        for (let a = 0; a < particles.length; a++) {
            for (let b = a + 1; b < particles.length; b++) {
                drawConnection(
                    particles[a].x, particles[a].y,
                    particles[b].x, particles[b].y,
                    CONNECTION_DISTANCE
                );
            }
        }
    }

    function connectMouseToParticles() {
        if (mouse.x === null || mouse.y === null) return;
        for (const particle of particles) {
            drawConnection(mouse.x, mouse.y, particle.x, particle.y, MOUSE_RADIUS);
        }
    }

    function animate() {
        if (!isVisible) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (const particle of particles) {
            updateParticle(particle);
            drawParticle(particle);
        }
        connectParticles();
        connectMouseToParticles();
        animationId = requestAnimationFrame(animate);
    }

    function start() {
        if (animationId !== null) return;
        animationId = requestAnimationFrame(animate);
    }

    function stop() {
        if (animationId === null) return;
        cancelAnimationFrame(animationId);
        animationId = null;
    }

    function onResize() {
        resizeCanvas();
        initParticles();
    }

    resizeCanvas();
    initParticles();
    start();

    window.addEventListener('resize', onResize, { passive: true });

    window.addEventListener('mousemove', (event) => {
        mouse.x = event.clientX;
        mouse.y = event.clientY;
    }, { passive: true });

    window.addEventListener('mouseout', () => {
        mouse.x = null;
        mouse.y = null;
    });

    document.addEventListener('visibilitychange', () => {
        isVisible = !document.hidden;
        if (isVisible) start();
        else stop();
    });
})();
