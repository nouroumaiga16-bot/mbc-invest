# MBC Transfert

Outil de gestion interne du service de transfert d'argent / change **CAD ⇄ FCFA** du Groupe MBC
(caisse CAD au Canada, caisse FCFA à la boutique MBC de Larlé, Ouagadougou).

- **Site** : page statique `transfert.html` (GitHub Pages), en français, pensée pour téléphone.
- **Serveur** : Google Apps Script (dossier `apps-script/`) + Google Sheets comme base de données,
  séparés de MBC Cargo.
- **Sécurité** : mots de passe hachés (SHA-256 + sel, 1000 tours), sessions de 8 h, rôles vérifiés
  côté serveur, journal d'audit scellé (chaîne d'empreintes), aucun secret dans le dépôt.

👉 Installation pas à pas : [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md)

## Avancement

| Phase | Contenu | État |
|------:|---------|------|
| 1 | Structure, classeur, connexion sécurisée, rôles, paramètres, journal d'audit | ✅ |
| 2 | Clients, bénéficiaires, KYC avec photos | À venir |
| 3 | Taux de change, transactions et règles anti-pertes | À venir |
| 4 | Caisses, équilibre, alertes, rééquilibrage, rapprochement | À venir |
| 5 | Flux internes du groupe | À venir |
| 6 | Rentabilité, tableau de bord, simulateur, exports | À venir |
| 7 | Conformité : détections et file d'examen | À venir |
| 8 | WhatsApp, reçus PDF, finitions | À venir |
| 9 | Scénarios de tests complets | À venir |

## Organisation des fichiers

```
transfert.html          Page unique du site
assets/transfert.css    Styles (fond noir, accents or/vert, gros boutons)
assets/transfert.js     Écrans et appels au serveur (aucune règle métier ici)
assets/config.js        Adresse publique du serveur Apps Script (pas un secret)
apps-script/            Code du serveur à coller dans Apps Script
  Config.gs             Tables, rôles, paramètres par défaut
  Installation.gs       Menu du classeur : installation, création de l'Admin
  Api.gs                Point d'entrée : liste des actions et rôles autorisés
  Securite.gs           Mots de passe, sessions, contrôle des rôles
  Audit.gs              Journal d'audit immuable et vérification d'intégrité
  Parametres.gs         Lecture / modification des paramètres
  Utilisateurs.gs       Gestion des comptes (Admin)
  BaseDonnees.gs        Lecture / écriture des onglets (pas de suppression possible)
  Utilitaires.gs        Montants en entiers, dates UTC, verrous
tests/                  Tests automatiques (simulent Google sur un ordinateur)
docs/DEPLOIEMENT.md     Guide d'installation
```

## Tests

```
npm test
```
