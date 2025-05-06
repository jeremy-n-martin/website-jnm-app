const canvas = document.getElementById('plexus-canvas');
const ctx = canvas.getContext('2d');

let particlesArray;

// Ajuster la taille du canvas à la fenêtre
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// Classe pour une Particule
class Particle {
    constructor() {
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        this.size = Math.random() * 5 + 1; // Taille aléatoire
        this.speedX = Math.random() * 3 - 1.5; // Vitesse horizontale aléatoire (-1.5 à 1.5)
        this.speedY = Math.random() * 3 - 1.5; // Vitesse verticale aléatoire (-1.5 à 1.5)
        this.color = '#e0e0e0'; // Couleur des particules
    }

    // Mettre à jour la position
    update() {
        // Gestion des bords
        if (this.x > canvas.width || this.x < 0) {
            this.speedX = -this.speedX;
        }
        if (this.y > canvas.height || this.y < 0) {
            this.speedY = -this.speedY;
        }
        this.x += this.speedX;
        this.y += this.speedY;
    }

    // Dessiner la particule
    draw() {
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
    }
}

// Initialiser les particules
function init() {
    particlesArray = [];
    let numberOfParticles = (canvas.height * canvas.width) / 9000; // Nombre basé sur la taille de l'écran
    if (numberOfParticles > 150) numberOfParticles = 150; // Limite max
    for (let i = 0; i < numberOfParticles; i++) {
        particlesArray.push(new Particle());
    }
}
init();

// Gérer les connexions entre particules
function connectParticles() {
    let opacityValue = 1;
    const maxDistance = 100; // Distance max pour connecter
    for (let a = 0; a < particlesArray.length; a++) {
        for (let b = a; b < particlesArray.length; b++) {
            let dx = particlesArray[a].x - particlesArray[b].x;
            let dy = particlesArray[a].y - particlesArray[b].y;
            let distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < maxDistance) {
                opacityValue = 1 - (distance / maxDistance);
                ctx.strokeStyle = `rgba(224, 224, 224, ${opacityValue})`; // Blanc avec opacité
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(particlesArray[a].x, particlesArray[a].y);
                ctx.lineTo(particlesArray[b].x, particlesArray[b].y);
                ctx.stroke();
            }
        }
    }
}

// Nouvelle fonction pour connecter la souris aux particules
function connectMouseToParticles() {
    if (mouse.x === null || mouse.y === null) return; // Ne rien faire si la souris est hors du canvas

    let opacityValue = 1;
    for (let i = 0; i < particlesArray.length; i++) {
        let dx = particlesArray[i].x - mouse.x;
        let dy = particlesArray[i].y - mouse.y;
        let distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < mouse.radius) {
            opacityValue = 1 - (distance / mouse.radius);
            ctx.strokeStyle = `rgba(224, 224, 224, ${opacityValue})`; // Même couleur que les lignes particules
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(mouse.x, mouse.y);
            ctx.lineTo(particlesArray[i].x, particlesArray[i].y);
            ctx.stroke();
        }
    }
}

// Optionnel : Interaction avec la souris
const mouse = {
    x: null,
    y: null,
    radius: 150 // Zone d'influence de la souris
};

window.addEventListener('mousemove', (event) => {
    mouse.x = event.clientX;
    mouse.y = event.clientY;
});

window.addEventListener('mouseout', () => {
    mouse.x = null;
    mouse.y = null;
});

// Boucle d'animation
function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height); // Effacer le canvas
    for (let i = 0; i < particlesArray.length; i++) {
        particlesArray[i].update();
        particlesArray[i].draw();
    }
    connectParticles();
    connectMouseToParticles();
    requestAnimationFrame(animate); // Demander la prochaine frame
}

// Lancer l'animation
animate();

// Ajuster la fonction connectParticles pour l'interaction souris (exemple simple)
// (Remplacer la fonction connectParticles existante ou l'ajouter)
// Pour l'instant, laissons l'interaction souris commentée ou simplifiée
// pour se concentrer sur l'effet de base.
// Nous pourrons ajouter une interaction plus poussée ensuite.

// Ajout : Recalculer les particules lors du redimensionnement
window.addEventListener('resize', () => {
    resizeCanvas();
    init(); // Réinitialiser les particules pour la nouvelle taille
}); 