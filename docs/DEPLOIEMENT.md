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

   Fichiers à créer : `Api`, `Audit`, `BaseDonnees`, `Config`, `Installation`, `Parametres`,
   `Securite`, `Utilisateurs`, `Utilitaires`.
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

## Bonnes pratiques de sécurité

- Validation en deux étapes sur le compte Google propriétaire du classeur.
- Ne partagez **ni** le classeur, **ni** le projet Apps Script, **ni** le dossier Drive privé.
- Chaque personne a son propre compte (jamais de compte partagé) : le journal d'audit dit qui a fait quoi.
- Quand une agente quitte l'entreprise : **Désactiver** son compte (jamais de suppression).
