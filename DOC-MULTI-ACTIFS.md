# Desk multi-actifs — documentation technique

Ce document décrit ce qui a été ajouté au Desk crypto de Captain Trading pour en faire une plateforme multi-actifs pour un investisseur français : marchés, portefeuille, allocation mensuelle, screener mensuel, backtest.

Il s'adresse à toi et à tout agent IA qui reprendra le code. Pour les recettes du quotidien et la carte complète des fichiers, voir `CLAUDE.md`.

> Les informations affichées ne constituent pas un conseil en investissement personnalisé. Les performances passées ne préjugent pas des performances futures.

Usage personnel. La mention « Captain Trading » est conservée. Cette version ne doit pas être proposée dans une offre payante sans accord écrit de Captain Trading.

---

## 1. Architecture

**Le Desk reste sans serveur.** La page est un seul fichier, `index.html`, assemblé par `build.mjs` à partir de `page.html`, des `.js` et des `.css`. Tout est lu depuis le navigateur. Ce que le navigateur ne peut pas lire lui-même est publié sous forme de fichiers JSON par deux robots GitHub :

| Robot | Fichier | Fréquence | Publie |
|---|---|---|---|
| News et agenda (d'origine) | `robot.mjs`, `desk.yml` | toutes les 10 min | agenda, news, FinancialJuice ; copie aussi la branche `donnees` dans `site/data/` |
| Données des marchés (nouveau) | `histo.mjs`, `donnees.yml` | 4 fois par jour en semaine, et le samedi | historiques quotidiens sur 15 ans, `resume.json`, `taux.json`, `fx.json`, `marches-meta.json`, dans la branche `donnees` |

**Le crypto existant n'a pas été réécrit**, seulement enveloppé. Les seules retouches au code crypto sont :
- une ligne d'export dans `screener.js` pour les tests ;
- le durcissement des connexions en direct dans `core.js` (phase 8, voir §12) ;
- l'ajout des nouveaux modules au démarrage.

L'indice de compression (CHOP) est protégé par un test de valeurs figées (`golden-chop.test.mjs`).

**Les nouveaux espaces ne chargent rien avant d'être ouverts** (`CK.onView`). Leurs appels au scanner TradingView restent sous un budget bas, avec un disjoncteur, pour ne jamais provoquer de refus (code 429) qui casserait les Signaux ou l'Agent.

**Le portefeuille, les règles et les journaux restent dans le navigateur** (`localStorage`). Ils ne sont jamais envoyés ni écrits dans le dépôt.

## 2. Migration, phase par phase

Chaque phase s'est terminée par la construction, les tests, un contrôle dans Chrome sans erreur, la mise à jour de `CLAUDE.md` et ta validation.

| Phase | Commit | Contenu |
|---|---|---|
| 0 | `115ce2b` | Node, kit de test `vmkit.mjs`, test golden du CHOP, workflow de tests séparé, `serve.mjs`, dépôt personnel |
| 1 | `4dae4df` | Socle : `models.js`, `datakit.js`, `fx.js`, `calendars.js`, `pea.js`, `providers.js`, `referentiel.json`, `allocation.json`, `fiscal.json` |
| 2 | `097000b` | Espace Marchés (touche 8) |
| 3 | `1daa215` | Historiques : `histo.mjs`, `donnees.yml`, `indicators.js`, IndexedDB, graphiques, courbes de taux |
| 4 | `f8f4f17` | Espace Portefeuille (touche 9) : `pfcore.js`, `portfolio.js` |
| 5 | `fc021a6` | Mes règles et allocation mensuelle : `prefs.js`, `allocation.js`, `selection.js`, `allocui.js` |
| 6 | `fbec67e` | Screener mensuel : `mscreen.js`, `msui.js` |
| 7 | `0e8bd28` | Backtest : `backtest.js`, `btui.js`, taux sans risque mensuel |
| 8 | (ce commit) | Connexions crypto plus solides, proposition du mois sur l'accueil, cette documentation |

## 3. Fichiers

Tous les fichiers restent à la racine du dossier : l'envoi par le site GitHub ne garde pas les dossiers. La carte complète, fichier par fichier, est dans `CLAUDE.md`. Les fichiers ajoutés pour le multi-actifs sont :
- **Navigateur** : `models.js`, `datakit.js`, `fx.js`, `calendars.js`, `pea.js`, `providers.js`, `indicators.js`, `markets.js`, `pfcore.js`, `portfolio.js`, `selection.js`, `allocation.js`, `prefs.js`, `allocui.js`, `mscreen.js`, `msui.js`, `backtest.js`, `btui.js`.
- **Données modifiables** : `referentiel.json` (les instruments), `allocation.json` (poches, profils, pondérations, seuils, coûts, séries de référence) et `fiscal.json` (règles fiscales datées et sourcées). Elles sont injectées dans la page par `build.mjs`.
- **Robot** : `histo.mjs`, `.github/workflows/donnees.yml`.
- **Tests** : `*.test.mjs` (voir §11).

## 4. Modèles de données (`models.js`)

Chaque modèle est documenté en JSDoc (`@typedef`) et a un normaliseur. Les normaliseurs :
- retirent les balises HTML et les caractères de contrôle ;
- bornent les longueurs ;
- refusent `__proto__` et `constructor` ;
- lisent les nombres au format français.

| Modèle | Normaliseur | Rôle |
|---|---|---|
| `Instrument` | `normInstrument` | ISIN, tickers (TradingView, Yahoo, OKX, Binance), classe, véhicule, zone, devise, statut PEA avec source et date, `alt_group` (même exposition), frais, niveau de risque, levier |
| `PriceBar` | `normBar` | bougie datée (instant de clôture) |
| `Quote` | `normQuote` | cotation instantanée, **pour l'affichage seulement** (jamais utilisée par le moteur ni le backtest) |
| `Account` | `normAccount` | PEA, PEA-PME, compte-titres, assurance-vie, portefeuille crypto, banque |
| `Position`, `Transaction` | `normPosition`, `normTransaction` | positions de départ, et opérations rejouées par date |
| `InvestmentPrefs` | `normPrefs` | tes règles : classes et types cochés, profil, horizon, mode PEA, versement, limites, filtres, poches écartées, poids personnalisés |

**Deux axes séparés** : la classe d'exposition (arbre `CLASSES`, où un enfant n'est autorisé que si son parent l'est) et le véhicule (titre, ETF, ETC/ETN, fonds, crypto au comptant, espèces).

**Garde-fou unique : `CK.allow(instrument, prefs)`.** Un instrument n'est jamais proposé si sa classe ou son véhicule n'est pas coché, s'il est à levier sans ton accord, ou s'il dépasse ton niveau de risque. `CK.allow.why` donne le motif.

## 5. Sources de marché (`providers.js`, `datakit.js`)

API commune `CK.mkt` :
- `quotes(ids)` : cotations ;
- `history(id, {from, to})` : historique ;
- `subscribe(ids, cb)` : abonnement, à arrêter à la sortie de l'espace ;
- `status(id)`, `resume()`, `taux()`.

| Source | Utilisée pour | Limites appliquées |
|---|---|---|
| Scanner TradingView | cotations des Marchés et du Portefeuille | un seul appel groupé, 4 par minute au plus, rien si l'onglet est caché, pause de 10 min si le crypto a reçu un refus |
| Flux OKX existant | cotations crypto | aucune requête nouvelle (lecture de `CK.S`) |
| Robot (fichiers JSON) | historiques, résumé, taux, change | 5 fichiers par seconde, cache IndexedDB par version de fichier |
| Binance `data-api.binance.vision` | historiques crypto | 2 requêtes par seconde, bougies clôturées seulement |

`datakit.js` apporte :
- un limiteur et un budget par source ;
- un cache ;
- un nouvel essai avec délai croissant ;
- un disjoncteur ;
- le journal visible dans Connexions.

## 6. Moteur d'allocation mensuelle (`allocation.js`, `selection.js`)

**Rien n'est calculé tant que « Mes règles » ne sont pas enregistrées.** Aucun ordre n'est jamais passé. Le vocabulaire est « Proposition du mois selon tes règles », jamais « conseil ».

**Date de décision** : dernière séance Euronext du mois, à 22 h 30 à Paris. Seules les clôtures connues à cette date sont utilisées (point-in-time). Les séries sont en euros, au fixing BCE du jour, ou à l'EURUSD du robot avant fin 2023, et **dividendes réinvestis** (`CK.ind.totalReturn`).

```
 1. Univers        classes ET types cochés, au moins un instrument proposable, poches non écartées
 2. Stratégique    poids du profil (ou personnalisés) × horizon, restreints à l'univers, remis à 100 %
 3. Inclinaison    w × (1 + t), t = inclinaison_max × (score − 50) / 50 ; score de rotation en série temporelle (5 ans)
 4. Régime         risk-off ou haute volatilité : 30 % du risque vers liquidités / obligations / or, s'ils sont cochés
 5. Volatilité     mélange avec le refuge (liquidités, sinon obligations) jusqu'à la cible du profil (covariance Ledoit-Wolf, 156 semaines)
 6. Contraintes    plafonds par classe, plafond crypto, plancher de liquidités, lignes bloquées (assurance-vie…)
 7-9. Mouvements   bande d'inaction ; rotation maximale (ventes d'actifs seulement : dépenser ses espèces n'est pas une vente)
10. Placement      par compte, sans transfert entre enveloppes (ajustement proportionnel itératif à partir de tes positions),
                   PEA toujours strict, plafond de versements, versement du mois là où il sert
11. Instruments    1 à 3 par poche, lignes détenues gardées, sans doublon d'exposition, plafond par instrument
12. Explications   action par classe (Renforcer, Réduire, Basculer, Passer en liquidités, Conserver, Ne rien faire),
                   raisons, risques, confiance, coûts, impôt indicatif, alternatives PEA
```

Les invariants sont vérifiés sur 500 combinaisons de cases (`allocation.test.mjs`) :
- une classe ou un type non coché vaut 0 ;
- la somme fait 100 % ;
- aucun poids n'est négatif ;
- les plafonds sont respectés ;
- les achats d'un compte ne dépassent jamais ses espèces, plus sa part du versement, plus ses ventes ;
- changer les cours postérieurs à la date de décision ne change rien.

## 7. PEA et sélection

**Ordre de priorité du statut PEA (`pea.js`)** :
1. ta correction ;
2. le référentiel, avec source et date ;
3. les règles certaines (obligations, ETC, matières premières, crypto, société hors UE/EEE → non éligible) ;
4. la règle légale pour une action ordinaire d'une société de l'UE/EEE (« à confirmer chez ton courtier ») ;
5. sinon « à vérifier ».

**Un fonds n'est jamais déclaré éligible par déduction.** L'enveloppe PEA est toujours stricte. La liste n'est jamais présentée comme exhaustive.

**Sélection (`selection.js`)** : `candidates` donne chaque instrument d'une poche, avec son motif d'exclusion. Les motifs possibles :
- les cases ou filtres de tes règles, ou le mode PEA strict ;
- des données trop anciennes ;
- un lancement après la date de décision ;
- une liquidité insuffisante ;
- aucun compte capable de le recevoir.

Le score de sélection est expliqué : ligne déjà détenue, devise, statut PEA, frais, spread, profondeur d'historique. Les titres en direct ne sont proposés que s'ils sont déjà détenus (voir §13).

## 8. Screener mensuel (`mscreen.js`)

Tout est calculé à la date de décision, en euros, dividendes réinvestis.

| Mesure | Formule |
|---|---|
| Momentum 1, 3, 6, 12 mois | `P(T) / P(T − k mois) − 1` (mois calendaires) ; 12-1 = `P(T − 1 mois) / P(T − 12 mois) − 1` |
| Momentum ajusté du risque | moyenne sur 3, 6 et 12 mois de `mom_k / (σ_120 j × √(k/12))` |
| Tendance | 25 points par condition : cours > MM50, > MM100, > MM200, MM50 > MM200 |
| Volatilité 20, 60, 120 j | écart-type des rendements logarithmiques × √252 (√365 pour la crypto) |
| ATR % | ATR 14 / cours (fonction du screener crypto) |
| Baisse et perte maximale | `P / max sur 1 an − 1` ; perte maximale sur 12 mois |
| RSI 14 (filtre seulement) | Wilder (fonction du screener crypto) ; > 75 surachat, < 25 survente |
| MACD (confirmation) | EMA12 − EMA26, signal EMA9 ; confirmé si MACD > signal et > 0 |
| Bollinger | largeur `4σ / MM20` et son centile sur un an (bas = compression) |
| Compression (CHOP 14) | **fonction inchangée du screener crypto**, bougies quotidiennes, et son centile ; affichée, pas comptée |
| Volume relatif, liquidité | volume / moyenne 10 j ; valeur échangée moyenne sur 10 j en euros |
| Corrélation, beta | rendements hebdomadaires sur 3 ans, contre la référence : CAC 40, STOXX 600, S&P 500, MSCI World ou série de la classe |
| Force relative | `mom 6 mois − mom 6 mois de la référence` |
| Diversification | `(1 − corrélation) × 50`, avec ton portefeuille, ou la référence si tu n'en as pas |
| Part du risque | `w_i (Σw)_i / wᵀΣw` pour tes lignes |

**Sous-scores (0-100)** :
- momentum, risque et volatilité : centile dans l'historique propre de l'instrument sur 5 ans ;
- tendance : en points ;
- diversification : par la formule du tableau.

**Score global** : moyenne pondérée selon `MSCREEN_WEIGHTS` (`allocation.json`).

**Étiquette** : la première règle vraie l'emporte, dans cet ordre. Les seuils sont dans `screener_seuils`.
1. Hors de tes classes.
2. Données insuffisantes → Surveiller.
3. Même exposition, moins chère ou éligible PEA, et dont le gain annuel couvre le coût de bascule si tu la détiens → Basculer.
4. RSI extrême → Surveiller.
5. Score ≥ 70, tendance ≥ 75 et 12 mois au-dessus du taux sans risque → Renforcer.
6. Score < 40, avec une tendance ≤ 25 ou un 12 mois négatif → Réduire.
7. Score ≥ 50 → Conserver.
8. Sinon → Surveiller.

Sans règles enregistrées, aucune étiquette n'est affichée. Un fonds monétaire est toujours « Conserver ».

## 9. Fichiers publiés par le robot (les « endpoints »)

Adresse : `https://lafouge-stack.github.io/Desk/data/…`

| Fichier | Contenu |
|---|---|
| `marches-meta.json` | `{v, updated, files: {nom: {id, src, ticker, ccy, first, last, n, note, err}}}` : un nom par historique, la correction appliquée (`note`) ou le motif de refus (`err`) |
| `hist/<id>.json` | `{id, ccy, src, ticker, tz, t[], o[], h[], l[], c[], v[], div[], split[]}` : quotidien sur 15 ans, `t` = instant de clôture, cours ajustés des divisions mais **pas des dividendes** (fournis dans `div`) |
| `resume.json` | `{items: {id: {d, c, p (performances), vol1y, mdd1y, hi52, lo52, n, first, spark}}}` |
| `taux.json` | `estr` (3 ans), `rf` (taux sans risque mensuel depuis 2005 : EONIA − 8,5 pb, puis €STR), taux de dépôt, courbes zone euro et États-Unis |
| `fx.json` | fixings BCE (via Frankfurter), sur 3 ans |

**API JavaScript internes** :

| API | Rôle |
|---|---|
| `CK.ref` | référentiel |
| `CK.pea` | statut PEA |
| `CK.allow` | garde-fou |
| `CK.fx.rate(devise, date)` | change daté, jamais un taux postérieur |
| `CK.ind` | indicateurs |
| `CK.pfc` | calculs du portefeuille |
| `CK.alloc.run` | proposition du mois |
| `CK.sel` | sélection et placement |
| `CK.ms.run` | screener mensuel |
| `CK.bt.create` / `run` / `grid` | backtest |
| `CK.prefs` | tes règles |

## 10. Espaces et écrans

| Touche | Espace | Contenu multi-actifs |
|---|---|---|
| 0 | Accueil | cartes Marchés et Portefeuille (lecture du cache et du stockage, aucune requête) ; proposition du mois si elle a été calculée |
| 1 à 2, 4 à 7 | Journée, Signaux, Liquidations, News, Agent, Connexions | inchangés ; Connexions montre aussi les nouvelles sources |
| 3 | Screener | bascule « Crypto (compression) / Mensuel multi-actifs » : le bloc crypto est seulement masqué en mode mensuel |
| 8 | Marchés | bandeau, onglets Indices, Actions, ETF, Obligations et taux, Matières premières, Devises ; fiche instrument (graphique, statistiques, statut PEA et correction) |
| 9 | Portefeuille | onglets Positions, Opérations, Répartition, **Allocation**, **Backtest**, Risques, Comptes ; bouton « Mes règles » |

Raccourcis Ctrl+K : « Aller à Marchés · … », « Aller à Portefeuille · … », « Mes règles d'investissement », « Proposition du mois », « Screener mensuel multi-actifs », « Backtest de tes règles ».

## 11. Tests

Commande : `node --test "*.test.mjs"`. Aucune installation n'est nécessaire. Les tests tournent aussi sur GitHub à chaque envoi, dans un workflow séparé : un test en échec ne bloque jamais les news.

| Fichier | Tests | Ce qu'il protège |
|---|---|---|
| `golden-chop` | 13 | CHOP, RSI, ATR % et mesures du screener crypto, valeurs figées |
| `models`, `security` | 127, 68 | normaliseurs, textes piégés, clés dangereuses, CSV français |
| `datakit`, `ws`, `providers`, `providers-integration` | 32, 14, 31, 13 | limiteur, disjoncteur, cache, reconnexion, budget TradingView |
| `fx`, `calendars`, `indicators` | 14, 18, 11 | change daté, jours fériés (Pâques), indicateurs point-in-time |
| `pea`, `referentiel` | 14, 12 | priorité des statuts, fonds jamais éligible par déduction, chaque ligne du référentiel |
| `histo` | 20 | robot des historiques (nettoyage, plan de mise à jour, BCE, FRED) |
| `markets` | 30 | espace Marchés |
| `pfcore`, `portfolio` | 20, 14 | opérations rejouées, valorisation, contrôles d'enveloppe, import CSV, risques, montants masqués |
| `allocation`, `allocui` | 22, 11 | 500 combinaisons de cases, point-in-time, enveloppes, Mes règles, journal |
| `mscreen` | 14 | dividendes réinvestis, CHOP inchangé, pondérations lues dans la configuration, table d'étiquettes |
| `backtest` | 15 | taux sans risque, mesures, exécution le jour ouvré suivant, frais, fiscalité, aucun regard vers l'avenir |
| `sockets` | 5 | connexions crypto : nouvel essai, retour du réseau, jamais deux connexions, aucun chien de garde |
| `build` | 3 | construction et présence de tous les fichiers |

Total : **521 tests** à la fin de la phase 8.

## 12. Connexions crypto (phase 8)

`socket()` (dans `core.js`) a été rendu un peu plus solide, sans rien changer d'autre :
- **Ouverture refusée** (le navigateur hors ligne, par exemple) : un nouvel essai est programmé, avec un délai qui double jusqu'à 60 s. Avant, la connexion était abandonnée pour toujours.
- **Retour du réseau** (événement `online`) : reconnexion immédiate au lieu d'attendre jusqu'à 60 s.
- **Jamais deux connexions** ni deux minuteries de reconnexion en même temps.
- **Volontairement aucun chien de garde sur l'absence de messages** (Binance peut rester muet en marché calme) et aucune pause quand l'onglet est caché.

## 13. Sources : conditions et limites

| Source | Statut | Conditions et limites |
|---|---|---|
| TradingView (scanner) | interface publique **non officielle**, non documentée | usage personnel ; peut changer ou refuser sans préavis ; budget bas et disjoncteur |
| Yahoo Finance (historiques, via le robot) | interface **non officielle** | conditions de Yahoo : pas de redistribution commerciale. Republié sur ton site pour un usage personnel, source citée. La page porte `noindex`, mais **les fichiers JSON eux-mêmes ne peuvent pas être exclus des moteurs de recherche** sur un site GitHub Pages de projet (ni `robots.txt` à la racine du domaine, ni en-tête HTTP possible). Séries parfois coupées ou fausses : nettoyage documenté, refus motivé. |
| BCE (Data Portal) | officiel | réutilisation autorisée avec mention de la source |
| FRED (Réserve fédérale de Saint-Louis) | officiel | taux du Trésor américain du domaine public ; mention de la source |
| Frankfurter | service libre qui republie les fixings BCE | dépend d'un service tiers ; repli sur l'EURUSD du robot |
| Binance `data-api.binance.vision` | public | données de marché ; conditions de Binance |
| OKX, Bybit, Binance (temps réel crypto) | publics | code d'origine du Desk |
| Statuts PEA | justETF, documents d'information clés (DIC), émetteurs | consultés à la main, avec source et date ; à revérifier au-delà de 12 mois |
| News, agenda, Agent | robot et relais de Captain Trading | inchangés |

## 14. Ce qui n'est pas couvert (liste honnête)

- **Backtest au niveau des classes seulement.**
  - Une série représentative par classe, et non tes instruments un par un ; les titres en direct ne sont pas simulés.
  - Univers des séries qui existent aujourd'hui (biais du survivant).
  - Pas de validation « walk-forward » ; calcul dans la page, pas en arrière-plan séparé.
- **Fiscalité simplifiée et indicative.**
  - Les taux actuels sont appliqués à tout le passé (prélèvements sociaux de 18,6 %, alors qu'ils étaient de 17,2 % avant 2026).
  - Pas de barème progressif.
  - Crypto : régime de l'article 150 VH bis non modélisé finement.
  - Assurance-vie : saisie manuelle, jamais proposée.
- **Titres en direct** : l'allocation garde ceux que tu détiens mais n'en choisit jamais de nouveaux. Le screener les classe, mais ne les sélectionne pas pour toi.
- **Argent, gaz naturel, immobilier coté** : pas de série historique fiable, donc le poids du profil s'applique sans inclinaison, avec une confiance faible.
- **Screener** : pas de mode « rapide » sur des milliers d'instruments, ni d'univers de 580 actions de Paris. Il classe le référentiel (environ 70 instruments).
- **Pas de proxys temps réel** pour les marchés traditionnels : cotations du scanner, avec le délai indiqué par la source.
- **Liquidité des ETF** : l'encours et le spread ne sont pas toujours connus. Dans ce cas, la règle d'exclusion ne s'applique pas.
- **PEA** : la liste des statuts n'est pas exhaustive. Le fonds monétaire EPEA reste « à vérifier » (sources contradictoires).
- **Import CSV des courtiers** : testé sur des fichiers fabriqués à la main. Un export réel peut demander d'ajouter des noms de colonnes (`SYN` dans `pfcore.js`).
- **Aucun ordre n'est passé, aucune connexion à un courtier.** Le portefeuille vit dans un seul navigateur. Pour changer d'appareil : bouton « Sauvegarder », puis « Importer ».

## 15. Recettes utiles

Elles sont détaillées dans `CLAUDE.md` :
- corriger le statut PEA d'un ETF ;
- ajouter un instrument au référentiel ;
- changer un profil, une poche, les pondérations ou les seuils du screener ;
- mettre à jour la fiscalité ;
- reconnaître un nouvel export de courtier ;
- sauvegarder et restaurer son portefeuille ;
- relancer le robot des données (GitHub → Actions → « Données des marchés » → Run workflow).
