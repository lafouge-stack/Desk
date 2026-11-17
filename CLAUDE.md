# Captain Trading · Desk — guide pour l'agent IA

Ce fichier explique le projet à un agent IA (Claude Code ou autre) pour qu'il puisse le modifier sans rien casser.
La personne qui te parle ne sait probablement pas coder : réponds en français simple, fais les modifications toi-même, puis vérifie-les.

## Ce qu'est le projet

Un tableau de bord de trading crypto et macro, en **un seul fichier HTML** (`index.html`), sans serveur ni clé API.
Toutes les données sont lues directement depuis le navigateur sur des API publiques (OKX, Binance, Bybit, Bitget, Hyperliquid, Deribit, Coinbase, CoinGecko, TradingView, FinancialJuice, Tree of Alpha…).
Un petit robot GitHub (`robot.mjs`) publie toutes les 10 minutes ce que le navigateur ne peut pas lire lui-même : agenda économique, news crypto traduites, copie de FinancialJuice.

## Règle d'or

- **On modifie les fichiers sources** (`page.html`, les `.js`, les `.css`, `config.js`), jamais `index.html` à la main : il est généré.
- Tous les fichiers sont à la racine du dossier (pas de sous-dossier : l'envoi de fichiers par le site GitHub ne garde pas les dossiers). Garde cette organisation.
- Après chaque modification : `node build.mjs`. Le script assemble `page.html`, les `.js` et les `.css` dans `index.html` et vérifie que le JavaScript est valide. S'il affiche une erreur, corrige-la avant de continuer.
- Puis lance les tests : `node --test "*.test.mjs"`. Tous doivent passer (✔). Un test en échec veut dire qu'une modification a cassé quelque chose : corrige le code, **ne modifie pas le test pour le faire passer** (surtout `golden-chop.test.mjs`, qui protège l'indice de compression du screener crypto).
- Node.js est nécessaire (version 22 ou plus). Sur ce poste, il est installé par winget dans `%LOCALAPPDATA%\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_…\node-v24…`. Si `node` est introuvable dans un terminal ouvert avant l'installation, ouvre un nouveau terminal.
- Pour voir le résultat : `node serve.mjs` puis ouvrir http://localhost:5173 (ou ouvrir `index.html` directement dans le navigateur).
- Après une modification visible, ouvre la page et vérifie qu'il n'y a pas d'erreur dans la console du navigateur.

## Carte des fichiers sources

| Fichier | Rôle |
|---|---|
| `config.js` | Réglages de départ : nom, sous-titre, couleur d'accent, thème, cryptos suivies, blocs affichés, adresse du robot (`data`). |
| `page.html` | Squelette de la page : barre du haut, un `<section class="mod" data-mod="…">` par bloc, fenêtres (Studio, alertes, calculateur…). |
| `style.css` | Style de base. Couleurs du thème sombre dans `:root[data-theme="dark"]`, du thème clair dans `:root[data-theme="light"]`. |
| `worlds.css` | Accueil, espaces, grille des blocs (12 colonnes), responsive, et les retouches récentes (en fin de fichier : ce sont elles qui l'emportent). |
| `core.js` | Le cœur : état partagé `CK.S`, utilitaires `CK.u` (formatage, `esc`, `safeUrl`), réseau (`fetchJSON`, `fetchText`, journal `CK.NET`), prix en direct (WebSocket), signaux (`FDEF`), agenda (`EV_FR` = traductions), news, graphiques TradingView, logo (`LOGO`), démarrage (`CK.boot`). |
| `layout.js` | Les espaces (`VIEWS`) et leurs blocs (`DEFAULTS` : ordre et largeur `w` de 1 à 12 colonnes), noms des blocs (`NAMES`), mode « Disposition ». |
| `worlds.js` | Écran d'accueil et couleur de chaque espace (`W`). |
| `day.js` | Frise « Journée de trading » : sessions, annonces, funding. |
| `signals.js` | Liste des signaux (familles dans `FAM`) et leurs explications. |
| `liqmap.js` | Carte des liquidations. |
| `pos.js` | Dérivés agrégés (open interest, funding, ratios). |
| `extra.js` | Niveaux clés, options Deribit, carnet d'ordres agrégé, alertes flash des news, corrélations. |
| `screener.js` | Screener (préréglages dans `PRESETS`, colonnes dans `COLS`). |
| `ui.js` | Studio, alertes de prix, calculateur de position, palette de commandes (Ctrl+K). |
| `net.js` | Espace « Connexions » : état en direct de chaque source (liste `SRC`, destinations `DEST`). |
| `markets.js` | **L'espace « Marchés »** (touche 8) `CK.mk` : bandeau (`STRIP`), onglets (`TABS`, `tabOf`, `groupOf`), tableau (`COLS`, `rowHTML`), filtre PEA (`peaPass`), écarts de taux (`SPREADS`), fiche instrument (`ficheHTML`, `peaBlock`, correction PEA), notes par onglet (`NOTES`). Se charge à la première ouverture de l'espace (`CK.onView`) : un seul abonnement `CK.mkt` (1 appel groupé par minute), arrêté quand on quitte l'espace. L'accueil lit seulement le cache (`CK.mk.home`). |
| `pfcore.js` | **Calculs du portefeuille** `CK.pfc` (sans affichage) : stockage dans le navigateur seulement (`CK.lsj("pf")`, jamais envoyé), comptes, positions de départ (`holdings`), opérations rejouées par date (`compute` : PRU frais inclus, réalisé, espèces, versements), instruments hors référentiel (`perso:…`, prix manuel), valorisation en euros (`value` : plus-value = part prix + part change), répartition (`GROUPS`, ordre fixe), contrôles d'enveloppe (`checks` : PEA strict via `CK.pea.allowedIn`, plafonds lus dans `fiscal.json`, 5 ans PEA, 8 ans assurance-vie), import CSV de courtier (`decode` UTF-8/Windows-1252, `parseCSV`, synonymes d'en-têtes `SYN`, `readCSV`, `applyCSV` sans doublons), sauvegarde JSON (`exportJSON`/`importJSON`, clés dangereuses refusées), risques (`weeklyEUR`, `risk` : volatilité, perte maximale, contributions, corrélations, `concentration` HHI), exemple (`demo`). |
| `portfolio.js` | **L'espace « Portefeuille »** (touche 9) `CK.pf` : synthèse (`resumeHTML`), onglets Positions · Opérations · Répartition · Risques · Comptes (`TABS`), fenêtre de saisie `#ovPf` (`accForm`, `posForm`, `txForm`, import `importPreviewHTML`), anneau SVG (`donutSVG`), export tableur (`positionsCSV`, formules neutralisées), « Masquer les montants » (`pf:hide`). Se charge à l'ouverture de l'espace : cotations seulement des lignes détenues (`heldIds`), historiques seulement dans l'onglet Risques. L'accueil lit seulement le stockage et le cache (`CK.pf.home`). |
| `veille.js` | **L'espace « Agent »** : affichage de la lecture du marché écrite par l'agent (`lectureHTML`, `actifCol`, `jauge`, `etat`), mise à jour en direct (`majLive`), lectures précédentes (`histo`), onglets Bilan (`viewBilan`) et Conso IA (`viewConso`), cartes BTC/ETH/SOL/dollar avec graphiques et niveaux (`card`, `cardUSD`, `niveaux`), indicateur TradingView (`PINE_AUTO`). |
| `models.js` | **Multi-actifs** : arbre des classes d'actifs (`CLASSES`, un enfant n'est autorisé que si son parent est coché), véhicules (`VEHICLES`), modèles (instrument, prix, cotation, compte, position, transaction, préférences) avec normaliseurs qui nettoient tout texte externe, garde-fou unique `CK.allow` (+ `CK.allow.why` pour le motif), référentiel `CK.ref`, phrase `CK.DISCLAIMER`. Les JSON éditables arrivent dans `CK.DATA` (marqueurs `"@@REFERENTIEL@@"`, `"@@ALLOCATION@@"`, `"@@FISCAL@@"` remplacés par `build.mjs`). |
| `datakit.js` | Réseau des nouveaux modules `CK.dk` : `fetch` (limiteur et budget par source, cache, nouvel essai, disjoncteur, onglet caché, option `accept` pour un code attendu comme le 404), `ws` (WebSocket avec reconnexion), `idb` (IndexedDB avec repli mémoire), `status`, `log`/`logs`. N'est PAS utilisé par le code crypto existant. |
| `fx.js` | Conversion en euros `CK.fx` (fixings BCE via Frankfurter, taux du jour, report du dernier fixing, GBX = pence, USDT ≈ USD). |
| `calendars.js` | Séances et jours fériés `CK.cal` (Euronext, Xetra, NYSE, crypto), calculés par règle (Pâques…), heure d'été gérée. |
| `pea.js` | Éligibilité PEA et PEA-PME `CK.pea` : `status`, `pmeStatus`, `allowedIn` (ce qu'un compte accepte), corrections de l'utilisateur (`setOverride`, `exportOverrides`), `alternatives`. |
| `providers.js` | Sources de marché `CK.mkt` : `quotes`, `history`, `subscribe`, `status`. Cotations via le scanner TradingView (un seul POST groupé, `?label-product=desk-marches`, au plus 4 par minute, rien si l'onglet est caché, pause si le crypto a reçu un 429), crypto lue dans le flux OKX existant, historiques du robot et de Binance. |
| `indicators.js` | Calculs sur historiques `CK.ind` (performances 1 sem à 10 ans, depuis janvier, volatilité, perte maximale, clôtures hebdomadaires, `summary`), **point-in-time** (rien après la date T). Partagé par la page et par le robot `histo.mjs` (mêmes chiffres partout). |
| `referentiel.json` | **Les instruments suivis** (ETF, actions, indices, taux, devises, crypto) avec ISIN, tickers TradingView/Yahoo, classe, zone d'exposition, statut PEA + source + date. Tous vérifiés le 16/11/2026 (tickers, ISIN, devises). |
| `allocation.json` | Poches, profils d'exemple (poids, volatilité cible), pondérations des scores, seuils du screener mensuel, coûts par type de compte, séries de référence. |
| `fiscal.json` | Règles fiscales indicatives datées et sourcées (PFU, prélèvements sociaux 18,6 % en 2026, PEA 5 ans, PEA-PME, assurance-vie, crypto). |
| `vmkit.mjs` | Kit de test : charge les fichiers du navigateur dans Node (faux `window`, `document`, `localStorage`, minuteries qui ne tournent pas). Fournit aussi des bougies de test déterministes (`candles`). |
| `*.test.mjs` | Tests automatiques (`node --test "*.test.mjs"`, aucune installation). `golden-chop.test.mjs` + `golden-chop.json` : valeurs de référence du screener crypto (CHOP, RSI, ATR %, metrics), à ne jamais régénérer sans raison. `build.test.mjs` : le build réussit et contient tous les fichiers. |
| `.github/workflows/tests.yml` | Lance les tests à chaque envoi sur GitHub. Séparé du robot : un test en échec ne bloque jamais la publication des news. Vérifie aussi que `index.html` a bien été reconstruit avant l'envoi. |
| `histo.mjs` | **Robot des historiques** (Node) : historiques quotidiens sur 15 ans (Yahoo ; FRED pour le 2 ans US ; BCE mensuel pour les 10 ans France, Allemagne, Italie), nettoyage documenté (pics isolés, ruptures impossibles, séries incohérentes ou arrêtées refusées), `resume.json` (performances, courbe d'un an), `taux.json` (€STR, taux de dépôt, courbes zone euro et US), `fx.json`. Mise à jour pilotée par l'état (`marches-meta.json`) : au plus 15 historiques complets et 60 mises à jour courtes par passage. `node histo.mjs dossier --tout` = amorçage complet en local. |
| `.github/workflows/donnees.yml` | Lance `histo.mjs` 4 fois par jour en semaine (et le samedi) et publie le résultat dans la branche **`donnees`** (un seul commit, remplacé à chaque passage). `desk.yml` copie ensuite cette branche dans `site/data/` toutes les 10 minutes. Séparé du robot : une erreur ici ne bloque jamais les news. |
| `desk-news-worker.js` | **Le relais Cloudflare** (code de l'agent et des news Telegram). Il ne tourne pas dans le navigateur : il se déploie sur Cloudflare Workers (voir plus bas). Aucune clé dedans : elles sont des secrets Cloudflare. |
| `niveaux-captain.pine` | L'indicateur TradingView « Niveaux Captain » (Pine v5), copié par le bouton « Indicateur TradingView » du Desk. |
| `agent-manuel.md` | Ancien manuel de l'agent, **plus utilisé** (l'agent actuel a sa méthode dans le relais). Ne pas le modifier. |
| `sound.js` | Ambiances sonores et sons d'interface. |
| `bg.js` | Fond animé. |

Tout le code partage l'objet global `window.CK`. Chaque fichier est une fonction auto-exécutée qui ajoute son module (`CK.day`, `CK.map`, `CK.layout`…).

## L'agent IA (espace « Agent », touche 6)

L'agent tourne sur un relais Cloudflare commun à tous les utilisateurs (`desk-news-worker.js`). Toutes les minutes, il mesure le marché (OKX, TradingView, news Telegram et Tree of Alpha, agenda) et calcule des faits (liquidations, levier, tendance, niveaux). Toutes les 30 min, juste après l'ouverture de l'Europe et de Wall Street, et tout de suite sur un événement fort (purge, gros mouvement, news majeure), une IA gratuite (Gemini, puis Groq en secours) écrit une **lecture du marché** : ce qui se passe, pourquoi, et pour chaque actif un scénario haussier et un baissier (déclencheur à au moins 0,2 % du prix, objectif à au moins 0,4 % au-delà). Le relais vérifie chaque prix cité et remplace un scénario absurde par celui du Desk.

Il suit ensuite chaque scénario comme un trade : déclenché sur une clôture 15 min au-delà du niveau, réussi si l'objectif est touché avant le stop (le niveau d'en face), noté dans le Bilan 4 h après.

Le Desk (`veille.js`) affiche :
1. la lecture en cours : titre, une ligne par actif avec le prix en direct, une jauge (le prix entre support et résistance), une phrase d'état, puis « Pourquoi », « À surveiller », « Tout change si » ;
2. les lectures précédentes, repliées ;
3. des cartes BTC, ETH, SOL et dollar avec graphiques et niveaux ;
4. les onglets « Bilan » (réussites et stops) et « Conso IA ».

Personne n'a de clé à mettre : les clés sont des secrets du relais, jamais dans le code, le Desk ou GitHub.

**Recettes**
- *Changer l'affichage de la lecture* : `lectureHTML`, `actifCol` et `jauge` dans `veille.js`, et les styles `.g13…` en fin de `worlds.css`.
- *Changer la fréquence des appels au relais* : `tgDelai()` dans `core.js` (version publique : toutes les 3 min si l'Agent ou les News sont à l'écran).
- *Avoir ton propre agent* (autres règles, autres actifs) : crée un Worker sur Cloudflare (offre gratuite), colle `desk-news-worker.js`, ajoute un espace KV nommé `DESK`, la liaison Workers AI nommée `AI`, le secret `GEMINI_KEY` (clé gratuite sur aistudio.google.com) et `GROQ_KEY` en option (console.groq.com), puis un déclencheur Cron `* * * * *`. Mets ensuite l'adresse de ton Worker dans `TG_URL` (`core.js`).

## Les news (espace « News »)

- Onglet **Tout** : toutes les sources réunies, une couleur par catégorie (`NCAT` et `newsRich` dans `core.js`, styles `.nr…` dans `worlds.css`).
- Onglet **X** : les tweets des gros comptes via Tree of Alpha (`wireParse` : listes `WACC`, `WVIP`, `WTRUMP`, `WONCH`, `WMAC` dans `core.js`) et les comptes « insiders » relayés par Telegram (liste `CHAINES` dans `desk-news-worker.js`, groupes dans `TGC` de `core.js`). Trump est aussi suivi sur Truth Social.
- Onglets Macro (FinancialJuice), Crypto et Articles.
- *Ajouter une chaîne Telegram publique* : l'ajouter dans `CHAINES` du relais (nom de la chaîne `t.me/s/NOM`), puis lui donner un groupe dans `TGC` (`core.js`).

## Studio et espaces

Le bouton « Studio » permet de choisir les espaces affichés sur l'accueil (`espaces` dans `DEF` de `core.js`, liste `W0` de `worlds.js`, `VIEWS0` de `layout.js`). Un espace décoché disparaît de l'accueil, du menu et de la page.
La liste des espaces du Studio est lue dans `VIEWS0` (`CK.layout.catalog()`) : un nouvel espace y apparaît tout seul. Seul le libellé « Agent IA » est surchargé (`ESP_LABEL` dans `ui.js`).

## Évolution multi-actifs (en cours)

Le Desk évolue vers une plateforme multi-actifs pour un investisseur français : actions, ETF, indices, obligations, matières premières, crypto, portefeuille, éligibilité PEA, allocation mensuelle, screener mensuel, backtest. Le plan a été validé le 12/11/2026. Il avance **phase par phase**, avec un arrêt pour validation à la fin de chacune :

| Phase | Contenu | État |
|---|---|---|
| 0 | Outillage : Node, tests (`vmkit.mjs`, golden), workflow de tests, `serve.mjs`, corrections Studio et accueil, dépôt GitHub personnel | fait |
| 1 | Socle de données : `models.js`, `datakit.js`, `fx.js`, `calendars.js`, `pea.js`, `providers.js`, `referentiel.json`, `allocation.json`, `fiscal.json` | fait |
| 2 | Espace « Marchés » (touche 8) : bandeau, 6 onglets, fiche instrument, badges et correction PEA, état de la source, avertissement partout, Ctrl+K, `#marches/etf` | fait |
| 3 | Historiques : `histo.mjs` + `donnees.yml` (branche `donnees`), `indicators.js`, copie IndexedDB, graphique et statistiques de la fiche, courbe d'un an dans le tableau, courbes de taux et €STR | fait |
| 4 | Espace « Portefeuille » (touche 9) : `pfcore.js` + `portfolio.js`, comptes, positions, opérations, import CSV et sauvegarde, valorisation en euros (prix / change), répartition, contrôles d'enveloppe, risques | fait (à valider) |
| 5 | Préférences d'investissement + allocation mensuelle | à faire |
| 6 | Screener mensuel (mode à côté du screener crypto) | à faire |
| 7 | Backtest | à faire |
| 8 | Finitions | à faire |

Décisions qui s'appliquent à tout le chantier :
- **Toujours sans serveur.** Les « endpoints » sont des fichiers JSON publiés par le robot. Le portefeuille reste uniquement dans le navigateur (jamais dans le dépôt ni sur un serveur).
- **Ne pas casser le crypto** : le code crypto existant est enveloppé, pas réécrit. Les nouveaux espaces se chargent seulement à leur ouverture. Les nouveaux appels au scanner TradingView restent sous un budget bas, avec un disjoncteur pour ne pas provoquer de refus (429) qui casseraient les Signaux et l'Agent.
- **Point-in-time** : le moteur d'allocation et le backtest n'utilisent que des historiques datés, jamais les valeurs instantanées du scanner TradingView.
- **Une classe ou un type d'actif non coché n'est jamais proposé** (garde-fou unique `CK.allow`).
- **PEA** : un fonds n'est jamais déclaré éligible par déduction ; l'enveloppe PEA est toujours stricte ; chaque statut affiche sa source et sa date.
- **Vocabulaire** : « Proposition du mois selon tes règles », jamais « conseil ». Le disclaimer exact est visible partout : « Les informations affichées ne constituent pas un conseil en investissement personnalisé. Les performances passées ne préjugent pas des performances futures. »
- **Licence** : usage personnel ; garder la mention « Captain Trading » ; ne jamais proposer cette version dans une offre payante sans accord écrit de Captain Trading.
- Nouveaux espaces ajoutés **après** Connexions (touches 8 et 9), pour ne pas renuméroter les touches existantes.

**Recettes multi-actifs**
- *Corriger le statut PEA d'un ETF* : dans `referentiel.json`, mettre `pea_eligibility_status` à `eligible` ou `not_eligible` **avec** `pea_source` (adresse de la fiche justETF, du DIC ou de l'émetteur) et `pea_last_checked_at` (date). Sans source, le statut est ignoré. Ne jamais marquer un fonds éligible sans source. Les actions gardent `unknown` : la règle (société UE/EEE) décide.
- *Historiques* : la source de chaque instrument est son ticker Yahoo du référentiel, sauf les taux de `RATES` (`histo.mjs`). Un instrument refusé (ex. SBF 120 : série Yahoo arrêtée en 2015) apparaît avec son motif dans `marches-meta.json` (champ `err`) et la fiche affiche « pas encore publié ». Toute correction automatique est notée (`note`) et affichée dans la fiche. Relancer tout à la main : GitHub → Actions → « Données des marchés » → Run workflow.
- *Changer le bandeau des Marchés* : liste `STRIP` dans `markets.js` (identifiants du référentiel, ex. `tv:EURONEXT:PX1`). Le gaz naturel s'affiche avec `marches: { gaz: true }` dans `config.js`.
- *Changer l'onglet d'un instrument* : `tabOf` et `groupOf` dans `markets.js` (l'onglet dépend de la classe et du véhicule du référentiel).
- *Nouvel espace chargé à la demande* : `CK.onView("id", function(ouvert){…})` (dans `layout.js`) appelle la fonction avec `true` à chaque entrée dans l'espace et `false` à la sortie.
- *Ajouter un instrument* : copier une ligne du même type dans `referentiel.json`, vérifier le ticker TradingView (il doit répondre au scanner avec le bon ISIN) et le ticker Yahoo, puis `node build.mjs` et `node --test "*.test.mjs"` (`referentiel.test.mjs` contrôle chaque ligne).
- *Changer un profil ou les poids des scores* : `allocation.json` (chaque profil doit totaliser 100).
- *Mettre à jour la fiscalité* : `fiscal.json` (taux, date d'effet, source, statut V/A).
- *Reconnaître un nouvel export de courtier* : ajouter le nom de colonne (sans accents, en minuscules) dans `SYN` de `pfcore.js`, et le sens d'opération dans `txType`. Tester avec `pfcore.test.mjs`.
- *Changer un plafond ou une durée d'enveloppe* : `fiscal.json` (`enveloppes`), lu par `checks` dans `pfcore.js`.
- *Couleurs des familles (anneau, barres)* : variables `--pf-1` à `--pf-7` en fin de `worlds.css` (thème sombre et clair, palette vérifiée pour le daltonisme) ; l'ordre de `GROUPS` (`pfcore.js`) fixe la couleur de chaque famille.
- *Portefeuille* : il reste dans le navigateur (`localStorage`, clé `…:pf`). Pour le changer d'appareil : bouton « Sauvegarder » (fichier JSON), puis « Importer » sur l'autre appareil. Ne jamais l'écrire dans le dépôt.
- Les tests qui chargent plusieurs fichiers dans `vmkit.mjs` : les tableaux créés « dans » le contexte ont un autre prototype ; écrire `assert.deepEqual([...x], …)`.

## Recettes courantes

**Changer les couleurs.** Couleur d'accent : `accent` dans `config.js`. Palette complète : les variables (`--bg`, `--text`, `--up`, `--down`…) dans `style.css`. Couleur d'un espace : `col` dans la liste `W` de `worlds.js`.

**Déplacer, élargir ou retirer un bloc dans un espace.** Modifier `DEFAULTS` dans `layout.js` : l'ordre des blocs suit `y` puis `x`, la largeur est `w` (12 = pleine largeur). Augmenter aussi la constante `LAYV` (ex. "9" → "10") pour que les navigateurs oublient l'ancienne disposition enregistrée.

**Ajouter un bloc.**
1. Dans `page.html`, ajouter une section sur le modèle des autres :
   `<section class="mod" data-mod="monbloc"><header class="mhd"><span class="mno"></span><h2>Titre</h2></header><div class="card"><div id="monbloc"></div></div></section>`
2. Dans `layout.js`, ajouter `monbloc` dans `NAMES`, `MIN` et dans `DEFAULTS` de l'espace voulu.
3. Dans `core.js`, ajouter `monbloc:true` dans `modules` de `DEF`.
4. Écrire le code du bloc dans un fichier existant (ou un nouveau fichier `monbloc.js`, à ajouter dans la liste `JS` de `build.mjs`) et le démarrer depuis `CK.boot` dans `core.js`.

**Ajouter une crypto dans la barre du haut.** `watchlist` dans `config.js` (symboles OKX, ex. "AVAX").

**Ajouter un signal.** Ajouter une entrée dans `FDEF` (`core.js`) sur le modèle des autres, puis sa clé dans `FAM` (`signals.js`) et son explication dans `CTX` (`signals.js`).

**Traduire une annonce de l'agenda.** Ajouter une ligne `[/texte anglais/i,"Texte français"]` au début de `EV_FR` dans `core.js`.

## Règles à respecter

- **Sécurité** : tout texte venu de l'extérieur (news, API) passe par `esc()` avant d'être inséré dans la page, et tout lien externe par `safeUrl()`. Ne jamais insérer une donnée externe brute dans `innerHTML`.
- **Pas de clé API dans le code** : le fichier est public. N'utilise que des sources qui marchent sans clé et qui autorisent les appels depuis un navigateur (en-tête CORS). Si une API refuse (erreur CORS), il faudra passer par le robot GitHub.
- **Pas de `</script>` ni de `</style>`** dans le JavaScript ou le CSS (le script de construction le refuse).
- **Noms de classes CSS** : préfère des noms précis (`monbloc-ligne`) aux noms génériques (`.past`, `.pin`, `.now`) déjà utilisés ailleurs, pour éviter les conflits.
- **Stockage navigateur** : passe par `CK.ls()` / `CK.lsj()` (préfixe commun, erreurs gérées).
- Les textes visibles sont en français.

## Le robot (optionnel)

Par défaut, `data` dans `config.js` pointe vers le robot de Captain Trading : l'agenda et les news fonctionnent tout de suite.
Pour avoir ton propre robot : mets ce dossier sur ton GitHub, active GitHub Pages (Settings → Pages → Source : GitHub Actions), puis remplace `data` par `https://TON-PSEUDO.github.io/NOM-DU-DEPOT`. Le fichier `.github/workflows/desk.yml` fait tourner `robot.mjs` toutes les 10 minutes.
