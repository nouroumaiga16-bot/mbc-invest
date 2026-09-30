# MBC Transfert — Guide d'installation et de déploiement

Ce guide est écrit pour une personne qui n'est pas développeur. Suivez les étapes dans l'ordre.
Durée : environ 30 minutes la première fois.

> **Règle d'or :** aucun mot de passe, aucune clé n'est jamais écrit dans le dépôt GitHub ni dans le site.
> Toutes les données et tous les contrôles restent dans Google (Apps Script + Google Sheets).

---

## Étape A — Créer la base de données (Google Sheets)

1. Connectez-vous au **compte Google de l'entreprise** qui gérera MBC Transfert
   (idéalement un compte **différent** de celui de MBC Cargo, avec la **validation en deux étapes activée**).
2. Allez sur <https://sheets.new> pour créer un classeur vide.
3. Renommez-le (en haut à gauche) : **MBC Transfert — Base de données**.
4. ⚠️ **Ne partagez jamais ce classeur.** Personne d'autre que vous ne doit y avoir accès :
   les agentes passent uniquement par le site.

## Étape B — Installer le serveur (Apps Script)

1. Dans le classeur : menu **Extensions → Apps Script**. Un nouvel onglet s'ouvre.
2. En haut à gauche, cliquez sur « Projet sans titre » et renommez-le **MBC Transfert — Serveur**.
3. Un fichier `Code.gs` existe déjà. Pour **chaque** fichier du dossier `apps-script/` du dépôt :
   - cliquez sur **+** (à côté de « Fichiers ») → **Script** ;
   - tapez le nom **sans** `.gs` (ex. `Config`) puis Entrée ;
   - effacez le contenu proposé et **collez** tout le contenu du fichier du dépôt.

   Fichiers à créer : `Api`, `Audit`, `BaseDonnees`, `Caisses`, `Clients`, `Config`, `Documents`,
   `Installation`, `Parametres`, `Securite`, `Taux`, `Transactions`, `Utilisateurs`, `Utilitaires`.
4. Supprimez le fichier `Code.gs` d'origine (clic sur les ⋮ à côté → Supprimer).
5. Cliquez sur la **roue dentée** (Paramètres du projet, à gauche) → cochez
   **« Afficher le fichier manifeste "appsscript.json" dans l'éditeur »**.
   Revenez à l'éditeur (icône `< >`), ouvrez `appsscript.json` et remplacez son contenu
   par celui du fichier `apps-script/appsscript.json` du dépôt.
6. Cliquez sur **💾 Enregistrer** (ou Ctrl+S).

## Étape C — Lancer l'installation

1. Revenez sur l'onglet du classeur et **rechargez la page** (F5).
   Après quelques secondes, un menu **MBC Transfert** apparaît à droite de « Aide ».
2. Menu **MBC Transfert → 1. Installer / mettre à jour les tables**.
3. Google demande une autorisation (c'est normal, c'est votre propre script) :
   - « Autorisation requise » → **Continuer** → choisissez votre compte ;
   - si vous voyez « Google n'a pas validé cette application » : cliquez sur **Paramètres avancés**
     puis **Accéder à MBC Transfert — Serveur (non sécurisé)** → **Autoriser**.
4. Relancez **1. Installer** si le menu vous le demande. Un message liste ce qui a été créé :
   16 onglets, les paramètres, les 2 caisses, les 2 entités, un dossier Drive privé
   (« MBC Transfert — Documents privés (NE PAS PARTAGER) ») pour les futures photos.
5. Menu **MBC Transfert → 2. Créer le compte Administrateur** :
   - identifiant : par exemple `nourou` ;
   - nom complet : `Nourou Maiga`.

   Un **mot de passe temporaire** s'affiche **une seule fois** : notez-le.

> L'installation peut être relancée à tout moment : elle n'efface jamais rien,
> elle ajoute seulement ce qui manque (utile lors des phases suivantes).

## Étape D — Publier le serveur (application web)

1. Dans Apps Script : bouton bleu **Déployer → Nouveau déploiement**.
2. Roue dentée à côté de « Sélectionner le type » → **Application Web**.
3. Remplissez :
   - Description : `Phase 1`
   - Exécuter en tant que : **Moi**
   - Qui a accès : **Tout le monde**
     *(nécessaire pour que le site puisse joindre le serveur ; l'accès aux données reste
     protégé par identifiant + mot de passe, vérifiés côté serveur)*
4. **Déployer** → copiez l'**URL de l'application Web** (elle se termine par `/exec`).

**Pour les mises à jour futures** (nouvelles phases) : collez les nouveaux fichiers, puis
**Déployer → Gérer les déploiements → ✏️ (modifier) → Version : Nouvelle version → Déployer**.
L'adresse `/exec` reste la même, pas besoin de toucher au site.

## Étape E — Publier le site (GitHub Pages)

1. Sur GitHub, ouvrez le fichier `assets/config.js` → icône ✏️ (modifier).
2. Remplacez `COLLER_ICI_L_ADRESSE_DE_L_APPLICATION_WEB` par l'adresse `/exec` copiée à l'étape D
   (gardez les apostrophes). **Commit changes**.
3. Dans le dépôt : **Settings → Pages** → Source : **Deploy from a branch** →
   Branche : `main`, dossier : `/ (root)` → **Save**.
4. Après 1 à 2 minutes, le site est disponible à :
   `https://nouroumaiga16-bot.github.io/mbc-invest/transfert.html`

> Remarques :
> - Le travail de la phase 1 est sur la branche `claude/mbc-transfert-cad-fcfa-wtxo03`.
>   Fusionnez-la dans `main` (Pull request → Merge) avant l'étape E, ou choisissez cette branche dans Pages.
> - GitHub Pages sur un dépôt **privé** nécessite un abonnement GitHub payant. Sur un dépôt **public**,
>   le code du site est visible par tous : ce n'est pas un problème, il ne contient aucun secret.

## Étape F — Tester la phase 1 (10 minutes)

| # | Action | Résultat attendu |
|---|--------|------------------|
| 1 | Ouvrir le site, se connecter avec un **mauvais** mot de passe | « Identifiant ou mot de passe incorrect. » |
| 2 | Se connecter avec le mot de passe temporaire | Écran « Choisissez votre mot de passe » |
| 3 | Choisir un mot de passe trop court (ex. `abc`) | Refus avec explication |
| 4 | Choisir un vrai mot de passe (10+ caractères, lettres + chiffres) | Accueil avec horloges Montréal / Ouagadougou |
| 5 | Paramètres → modifier `BOUTIQUE_ADRESSE` sans justification | Refus : justification obligatoire |
| 6 | Même chose avec une justification | « Paramètre enregistré » |
| 7 | Utilisateurs → créer `awa.larle`, rôle Agent Ouaga | Mot de passe temporaire affiché une fois |
| 8 | Sur un **téléphone** (ou fenêtre privée), se connecter comme `awa.larle` | Changement de mot de passe, puis accueil **sans** les menus Paramètres / Utilisateurs / Journal |
| 9 | Admin → désactiver `awa.larle` | Sur le téléphone, l'action suivante renvoie à l'écran de connexion |
| 10 | 5 mauvais mots de passe de suite sur un compte | Compte bloqué 15 minutes (débloquable par l'Admin) |
| 11 | Journal d'audit → « Vérifier l'intégrité » | ✅ Journal intact |
| 12 | Dans le classeur, modifier à la main une cellule de `JournalAudit`, puis revérifier | ⚠️ Alerte indiquant la ligne modifiée (remettez ensuite la valeur d'origine) |

Tests automatiques (pour un développeur) : `node --test tests/*.test.js` (Node.js 18+).

## Mettre à jour vers une nouvelle phase

1. Dans Apps Script, remplacez le contenu de **chaque** fichier par la nouvelle version du dépôt,
   et créez les nouveaux fichiers (phase 2 : `Clients`, `Documents` ; phase 3 : `Taux`, `Transactions`, `Caisses`).
2. Enregistrez, puis dans le classeur : menu **MBC Transfert → 1. Installer / mettre à jour les tables**
   (ajoute les nouvelles colonnes et les nouveaux paramètres, sans rien effacer).
3. **Déployer → Gérer les déploiements → ✏️ → Version : Nouvelle version → Déployer**.
4. Sur GitHub, le site se met à jour tout seul après la fusion dans `main`.

## Tester la phase 2 (15 minutes)

| # | Action | Résultat attendu |
|---|--------|------------------|
| 1 | Clients → **+ Nouveau client**, laisser « Profession » vide | Refus : champ obligatoire |
| 2 | Remplir tout, pièce **CNIB**, ajouter seulement la photo recto (prise avec le téléphone) | Client `CLI-000001` créé, statut **Nouveau**, « Il manque la photo du verso » |
| 3 | **✔ Vérifier le client** | Refus : verso manquant |
| 4 | Ajouter le verso depuis la fiche, puis **Vérifier** sans cocher la case | Refus : confirmation requise |
| 5 | Cocher la case et confirmer | Statut **Vérifié** |
| 6 | **Modifier** → changer l'adresse | Reste **Vérifié** |
| 7 | **Modifier** → changer le numéro de pièce | Repasse à **Nouveau** (à revérifier) |
| 8 | Créer un 2ᵉ client avec la **même pièce** (même numéro, même avec des espaces) | Refus : « déjà enregistrée pour le client CLI-000001 » |
| 9 | Créer un client avec une date d'expiration **passée** | Fiche en rouge « Pièce expirée : aucune transaction possible » |
| 10 | Ajouter un bénéficiaire, puis le même une 2ᵉ fois | 2ᵉ ajout refusé (doublon) |
| 11 | **Bloquer** sans motif, puis avec motif | Refus, puis statut **Bloqué** |
| 12 | Rechercher par une partie du nom, du téléphone ou du numéro de pièce | Le client est trouvé |
| 13 | Google Drive → dossier « MBC Transfert — Documents privés » → `Clients/CLI-000001` | Les photos y sont ; le dossier n'est partagé avec personne |
| 14 | Journal d'audit | Création, photos, consultation des photos, vérification, blocage sont tracés |

## Tester la phase 3 (20 minutes)

| # | Action | Résultat attendu |
|---|--------|------------------|
| 1 | Transactions → + Nouvelle, **avant** d'avoir saisi un taux | Bandeau rouge ; création refusée « Aucun taux saisi » |
| 2 | Taux → saisir `440` | Taux A 430, taux B 450 (marges d'exemple de 10) |
| 3 | Saisir ensuite `480` | Demande de confirmation (écart de plus de 5 %) |
| 4 | Nouvelle transaction flux A, 500 CAD, client vérifié | Le client paie 505,00 CAD, le bénéficiaire reçoit 215 000 FCFA ; **code à 6 chiffres affiché une fois** |
| 5 | Confirmer le paiement sans référence, puis avec une référence Interac | Refus, puis « Paiement confirmé » ; la caisse CAD augmente |
| 6 | Créer une 2ᵉ transaction et réutiliser la même référence Interac | Refus : référence déjà utilisée |
| 7 | **Valider** alors que la caisse FCFA est vide | Refus : caisse FCFA insuffisante |
| 8 | Caisses → apport de 2 000 000 FCFA, puis Valider | Validée ; la caisse FCFA montre 215 000 FCFA « promis » |
| 9 | Autoriser la remise (nouveau client) | Refus : délai de sécurité de 24 h |
| 10 | Après le délai : code **faux** | Refus « Code incorrect (1/5) » |
| 11 | Bon code + numéro de pièce | « Remise autorisée » + bouton « Envoyer à la boutique (WhatsApp) » |
| 12 | « Remise faite » sans photo, puis avec photo | Refus, puis « Payée » ; la caisse FCFA baisse de 215 000 |
| 13 | Transaction de plus de 3 000 CAD → Valider | Mot de passe + 3 cases à cocher obligatoires |
| 14 | Client **non vérifié** : transaction de 1 200 CAD | Refus : client non vérifié au-dessus du seuil |
| 15 | Flux B, 1 000 CAD : confirmer (reçu boutique), valider, « Virement Interac envoyé » | Référence obligatoire ; la caisse CAD baisse de 1 000 CAD |

## Bonnes pratiques de sécurité

- Validation en deux étapes sur le compte Google propriétaire du classeur.
- Ne partagez **ni** le classeur, **ni** le projet Apps Script, **ni** le dossier Drive privé.
- Chaque personne a son propre compte (jamais de compte partagé) : le journal d'audit dit qui a fait quoi.
- Quand une agente quitte l'entreprise : **Désactiver** son compte (jamais de suppression).
