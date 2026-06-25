# Contenu Markdown

Placez vos fichiers `.md` ici. Chaque fichier devient une page web via le script de build.

## Convention de nommage

- `mon-sujet.md` → `pages/mon-sujet.html`
- Le titre de la page est extrait du premier `# Titre` du fichier
- Une description optionnelle peut être ajoutée en frontmatter YAML :

```yaml
---
title: Mon titre personnalisé
description: Courte description pour les meta tags
---
```

## Générer les pages

```bash
npm install
npm run build
```

Le script met aussi à jour `pages.json` pour la navigation automatique.
