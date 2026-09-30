/**
 * Vérifie que installation/Code.gs (le fichier unique à copier dans Apps Script)
 * est à jour et fonctionne comme les fichiers séparés.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { creerEnvironnement } = require('./simulateur-google');

const FICHIER = path.join(__dirname, '..', 'installation', 'Code.gs');

test('installation/Code.gs est à jour (sinon lancer : npm run regrouper)', () => {
  const avant = fs.readFileSync(FICHIER, 'utf8');
  execFileSync('node', [path.join(__dirname, '..', 'outils', 'regrouper.js')]);
  assert.equal(fs.readFileSync(FICHIER, 'utf8'), avant);
});

test('Le fichier unique s\'installe et permet de se connecter', () => {
  const ctx = creerEnvironnement({ fichierUnique: FICHIER });
  ctx.installer();
  ctx.__reponsesPrompt.push('nourou', 'Nourou Maiga');
  ctx.creerAdministrateurInitial();
  const mdp = /Mot de passe temporaire : (\S+)/.exec(ctx.__alertes.join('\n'))[1];
  const r = JSON.parse(JSON.stringify(ctx.traiterDemande_(JSON.stringify({ action: 'auth.connexion', donnees: { identifiant: 'nourou', motDePasse: mdp } }))));
  assert.equal(r.ok, true);
});

test('INSTALLER_TOUT fonctionne depuis l\'éditeur, même sans classeur attaché ni menu', () => {
  const ctx = creerEnvironnement({ fichierUnique: FICHIER, scriptIndependant: true });
  assert.match(fs.readFileSync(FICHIER, 'utf8').split('function ')[1], /^INSTALLER_TOUT\(/); // première fonction du fichier
  ctx.INSTALLER_TOUT();
  const journal = ctx.__journal.join('\n');
  assert.match(journal, /INSTALLATION TERMINÉE/);
  const mdp = /Mot de passe temporaire : (\S+)/.exec(journal)[1];
  const r = JSON.parse(JSON.stringify(ctx.traiterDemande_(JSON.stringify({ action: 'auth.connexion', donnees: { identifiant: 'nourou', motDePasse: mdp } }))));
  assert.equal(r.ok, true);
  // Relancer ne recrée pas de compte et n'efface rien.
  ctx.__journal.length = 0;
  ctx.INSTALLER_TOUT();
  assert.match(ctx.__journal.join('\n'), /existe déjà/);
  assert.deepEqual(ctx.__erreurs, []);
});

test('REINITIALISER_MOT_DE_PASSE : nouveau mot de passe temporaire, compte débloqué', () => {
  const ctx = creerEnvironnement({ fichierUnique: FICHIER, scriptIndependant: true });
  ctx.INSTALLER_TOUT();
  const api = (a, d) => JSON.parse(JSON.stringify(ctx.traiterDemande_(JSON.stringify({ action: a, donnees: d }))));
  for (let i = 0; i < 5; i++) api('auth.connexion', { identifiant: 'nourou', motDePasse: 'oublie' }); // compte bloqué
  ctx.__journal.length = 0;
  ctx.REINITIALISER_MOT_DE_PASSE();
  const mdp = /Mot de passe temporaire : (\S+)/.exec(ctx.__journal.join('\n'))[1];
  const r = api('auth.connexion', { identifiant: 'nourou', motDePasse: mdp });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.donnees.utilisateur.doitChangerMdp, true);
});
