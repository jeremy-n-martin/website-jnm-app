# Releases des jeux

Le site (`jnm.app`) est généré par `tools/build.mjs` dans `dist/`, puis déployé par GitHub Pages
(`.github/workflows/deploy.yml`) à chaque push sur `main`. Les binaires des jeux ne sont **jamais** dans git :
ils sont sur Cloudflare R2 et servis par `https://dl.jnm.app`.

```
D:\godot\<jeu>            projet Godot (source, pas de git)
        │  release.ps1 build      export Windows / Android / macOS (Godot en ligne de commande)
        ▼
%LOCALAPPDATA%\jnm-release\stage\<slug>\<version>\   + copie dans D:\build\{windows,android,mac}
        │  release.ps1 shots      captures → content/games/<slug>/media/*.webp
        │  release.ps1 publish    envoi R2 → game.json → rétention → build du site → commit + push
        ▼
R2 : jnm-games/<slug>/<version>/<slug>-v<version>-{windows-x64.exe|android.apk|macos.zip}
Site : content/games/<slug>/game.json  →  /jeux/ et /jeux/<slug>/ (les anciennes adresses /releases/… redirigent)
```

## Commandes

```powershell
./tools/release.ps1 build   commun                 # exporte les 3 plateformes
./tools/release.ps1 shots   commun                 # captures (tools/shots.gd du jeu, sinon écran titre)
./tools/release.ps1 publish commun -Notes "…"      # met en ligne
./tools/release.ps1 list                           # jeux et versions (entre parenthèses : archivées)
```

Options utiles :

- `build -Windows <exe> -Android <apk> -Mac <zip>` : publier des builds déjà faits sans réexporter.
- `build -Platforms windows,android` : seulement certaines plateformes.
- `build -Force` : remplacer une version déjà publiée.
- `shots -From <dossier>` : importer ses propres PNG.
- `publish -Milestone` : version jamais archivée.
- `publish -Keep 5` : nombre de versions téléchargeables (défaut : `keep` dans `release.config.json`).
- `publish -SkipUpload` / `-NoPush` : tests locaux, rien n'est mis en ligne.

En local : `npm run dev` (http://localhost:3000).

## Fiche (`content/games/<slug>/game.json`)

| Champ | Rôle |
|---|---|
| `title`, `source` | nom affiché, dossier dans `D:\godot` (lien stable entre le projet et sa fiche) |
| `tagline` | une phrase, affichée sur la carte |
| `summary`, `controls` | markdown simple : paragraphes, `- ` listes, `**gras**`, `*italique*`, `` `code` `` |
| `genres` | 2 ou 3, servent de filtres |
| `status`, `players`, `language` | infos de la fiche |
| `pixelArt` | `true` : agrandissement net des captures |
| `media` | `cover`, `icon`, `screenshots` (chemins relatifs à la fiche) |
| `versions` | écrit par `publish` : version, date, notes, fichiers (clé R2, taille, SHA-256), `available`, `milestone` |
| `hidden` | `true` : la fiche n'est pas publiée |

## Rétention

À chaque `publish`, seules les `keep` dernières versions (3 par défaut) et les jalons restent téléchargeables ;
les autres sont supprimées de R2 mais gardent leur ligne de changelog. Coût indicatif : 100 jeux × 3 versions
× 250 Mo ≈ 75 Go, soit environ 1 $/mois (R2 ne facture pas les téléchargements).

## Mise en place (une seule fois)

1. **Cloudflare** : créer un compte, *Add a domain* → `jnm.app` (plan Free). Vérifier les enregistrements importés :
   4 × `A` vers `185.199.108-111.153`, `CNAME www → jeremy-n-martin.github.io`, le `TXT google-site-verification`.
   Les laisser en **DNS only** (nuage gris) pour que GitHub Pages garde son certificat HTTPS.
   Puis, chez GoDaddy, remplacer les serveurs de noms par ceux donnés par Cloudflare.
2. **R2** : activer R2 (carte bancaire demandée, palier gratuit 10 Go), créer le bucket `jnm-games`,
   puis *Settings → Custom Domains* → `dl.jnm.app`.
3. **Clé API** : *R2 → Manage API tokens → Create* : « Object Read & Write », limitée au bucket `jnm-games`.
   Copier l'Account ID, l'Access Key ID et le Secret dans `~/.jnm/r2.env` :

   ```
   R2_ACCOUNT_ID=...
   R2_ACCESS_KEY_ID=...
   R2_SECRET_ACCESS_KEY=...
   R2_BUCKET=jnm-games
   ```
4. **rclone** : `winget install Rclone.Rclone` (aucune configuration : le script la passe par variables d'environnement).

## Signature

- **Android** : le keystore du preset signe l'APK. Garder le même pour un jeu, sinon les mises à jour ne
  s'installent plus par-dessus l'ancienne version.
- **Windows / macOS** : non signés. Les fiches expliquent comment passer SmartScreen et Gatekeeper.
