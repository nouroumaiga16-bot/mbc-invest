/**
 * Regroupe tous les fichiers du dossier apps-script/ en UN seul fichier
 * (installation/Code.gs), pour n'avoir qu'un copier-coller à faire dans Apps Script.
 * Lancer avec :  npm run regrouper
 */
'use strict';
const fs = require('fs');
const path = require('path');
const dossier = path.join(__dirname, '..', 'apps-script');
// Demarrage.gs en premier : sa fonction INSTALLER_TOUT est alors celle proposée par défaut dans l'éditeur.
const fichiers = fs.readdirSync(dossier).filter((f) => f.endsWith('.gs')).sort()
  .sort((a, b) => (a === 'Demarrage.gs' ? -1 : b === 'Demarrage.gs' ? 1 : 0));
let sortie = '/**\n * MBC Transfert — serveur complet en un seul fichier.\n' +
  ' * Fichier GÉNÉRÉ automatiquement à partir du dossier apps-script/ : ne pas modifier à la main.\n' +
  ' * Copiez TOUT ce fichier dans le fichier « Code.gs » de votre projet Apps Script.\n */\n';
fichiers.forEach((f) => {
  sortie += '\n\n/* ======================================================================\n * ' + f +
    '\n * ====================================================================== */\n\n' + fs.readFileSync(path.join(dossier, f), 'utf8');
});
fs.mkdirSync(path.join(__dirname, '..', 'installation'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'installation', 'Code.gs'), sortie);
fs.copyFileSync(path.join(dossier, 'appsscript.json'), path.join(__dirname, '..', 'installation', 'appsscript.json'));
console.log('installation/Code.gs : ' + fichiers.length + ' fichiers regroupés.');
