# Releases des jeux

Le site (`jnm.app`) est généré par `tools/build.mjs` dans `dist/`, puis déployé par GitHub Pages
(`.github/workflows/deploy.yml`) à chaque push sur `main`. Les binaires des jeux ne sont **jamais** dans git :
ils sont sur Cloudflare R2 et servis par `https://dl.jnm.app`.

```
D:\godot\<jeu>            projet Godot (source, pas de git)
        │  release.ps1 doctor     presets conformes : exe autonome x64, macOS universel, APK ARM64
        │  release.ps1 bump       version +1 (0.007 → 0.008) dans project.godot et tous les presets
        │  release.ps1 build      export des 3 plateformes, tests du projet, test de démarrage de l'exe
        ▼
%LOCALAPPDATA%\jnm-release\stage\<slug>\<version>\   + D:\build\{windows,android,mac}\<Nom> v<version>.<ext>
        │  release.ps1 shots      3 captures → content/games/<slug>/media/shot-XX.webp
        │  release.ps1 publish    envoi R2 → game.json → rétention → build du site → commit + push
        ▼
R2 : jnm-games/<slug>/<version>/<slug>-v<version>-{windows-x64.exe|android.apk|macos.zip}
Site : content/games/<slug>/game.json  →  /jeux/ et /jeux/<slug>/ (les anciennes adresses /releases/… redirigent)
```

`release.ps1 ship <jeu> -Notes "…"` enchaîne tout. C'est ce qu'utilise le skill `/release-game`.

## Commandes

```powershell
./tools/release.ps1 ship    commun -Notes "…"      # tout : version +1, export, tests, captures, mise en ligne
./tools/release.ps1 doctor  commun                 # contrôle et corrige les presets
./tools/release.ps1 bump    commun                 # version +1 seulement
./tools/release.ps1 build   commun                 # exporte les 3 plateformes
./tools/release.ps1 shots   commun                 # 3 captures (-Count 10 pour plus)
./tools/release.ps1 publish commun -Notes "…"      # met en ligne la version préparée
./tools/release.ps1 list                           # jeux et versions (entre parenthèses : archivées)
```

Contrôles avant mise en ligne (un échec bloque la publication) :

- **Tests** : chaque `tests/test_*.gd` du projet est lancé en headless ; un code de sortie non nul bloque (`-SkipTests` pour passer outre).
- **Version** : les numéros vus par les joueurs (project.godot, Android `version/name`, macOS `short_version`) doivent
  être identiques. Puis le jeu est lancé sans fenêtre avec `tools/godot/jnm_versioncheck.gd` injecté : la version
  doit apparaître dans un texte visible de l'écran titre, et aucun autre numéro de version ne doit y figurer.
  Un texte placé ailleurs qu'en bas, ou qui chevauche un autre texte, donne un avertissement.
- **Test de démarrage** : l'exe Windows exporté est lancé sans fenêtre pendant 300 images ; il doit quitter avec le code 0.
  Les erreurs de script au démarrage sont signalées.
- Tests, démarrage et captures tournent avec `user://` redirigé vers un dossier jetable (`override.cfg` temporaire) :
  la vraie sauvegarde n'est jamais modifiée.

Captures (`shots`) : si le projet a un `tools/shots.gd`, il est utilisé (`extends SceneTree` → lancé avec `-s` ;
`extends Node` → injecté en autoload, lit `JNM_SHOTS_DIR`). L'explorateur générique `tools/godot/jnm_autoshots.gd`
complète jusqu'à 3 images (`-Count`) en cliquant les boutons et en envoyant touches et clics.

Options utiles :

- `ship -Shots` : refaire les captures. `ship -NoBump` : garder la version. `ship -Version 0.100` : imposer un numéro.
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
