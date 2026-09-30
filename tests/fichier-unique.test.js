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
