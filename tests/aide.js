/**
 * Outils communs aux tests : système installé, Admin et agent prêts à l'emploi.
 */
'use strict';
const assert = require('node:assert/strict');
const vm = require('vm');
const { creerEnvironnement } = require('./simulateur-google');

/** Prépare un système installé avec un Admin qui a déjà changé son mot de passe. */
function systemePret() {
  const ctx = creerEnvironnement();
  const ev = (code) => vm.runInContext(code, ctx);
  // Comme en vrai, la réponse passe par du texte JSON.
  const api = (action, donnees, jeton) => JSON.parse(JSON.stringify(ctx.traiterDemande_(JSON.stringify({ action, donnees, jeton }))));

  ctx.installer();
  ctx.__reponsesPrompt.push('Nourou', 'Nourou Maiga');
  ctx.creerAdministrateurInitial();
  const mdpTemp = /Mot de passe temporaire : (\S+)/.exec(ctx.__alertes.join('\n'))[1];

  const c = api('auth.connexion', { identifiant: 'nourou', motDePasse: mdpTemp });
  assert.equal(c.ok, true, JSON.stringify(c));
  const r = api('auth.changerMotDePasse', { ancien: mdpTemp, nouveau: 'MonSecret2026' }, c.donnees.jeton);
  assert.equal(r.ok, true, JSON.stringify(r));
  return { ctx, ev, api, jetonAdmin: c.donnees.jeton, mdpTemp };
}

/** Crée un agent Ouaga prêt à l'emploi et renvoie son jeton. */
function creerAgent(s) {
  const cr = s.api('utilisateurs.creer', { identifiant: 'awa.larle', nomComplet: 'Awa', role: 'AGENT_OUAGA' }, s.jetonAdmin);
  assert.equal(cr.ok, true, JSON.stringify(cr));
  const c = s.api('auth.connexion', { identifiant: 'awa.larle', motDePasse: cr.donnees.motDePasseTemporaire });
  s.api('auth.changerMotDePasse', { ancien: cr.donnees.motDePasseTemporaire, nouveau: 'Larle2026ok' }, c.donnees.jeton);
  return { id: cr.donnees.id, jeton: c.donnees.jeton };
}

module.exports = { systemePret, creerAgent };
