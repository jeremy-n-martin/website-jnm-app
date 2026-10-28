-- Demandes des joueurs (bugs, idées) : une ligne par demande, identifiée par son code de suivi.
CREATE TABLE IF NOT EXISTS requests (
    code         TEXT PRIMARY KEY,               -- code de suivi donné au joueur (8 caractères)
    game         TEXT NOT NULL,                  -- slug du jeu (content/games/<slug>)
    kind         TEXT NOT NULL,                  -- bug | idee | autre
    title        TEXT NOT NULL,
    body         TEXT NOT NULL DEFAULT '',       -- détails : jamais affichés publiquement
    platform     TEXT NOT NULL DEFAULT '',
    game_version TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'attente', -- attente | prevue | implementee | refusee
    public       INTEGER NOT NULL DEFAULT 0,     -- 1 : relue, visible dans la liste publique
    note         TEXT NOT NULL DEFAULT '',       -- réponse publique
    done_version TEXT NOT NULL DEFAULT '',       -- version qui l'implémente
    ip_hash      TEXT NOT NULL DEFAULT '',       -- empreinte salée du jour, pour limiter les envois
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS requests_game ON requests (game, status);
CREATE INDEX IF NOT EXISTS requests_ip ON requests (ip_hash, created_at);
