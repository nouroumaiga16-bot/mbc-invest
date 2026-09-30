/**
 * Tests automatiques — taux de change automatique (FCFA fixé à l'euro, cours BCE).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { systemePret } = require('./aide');

const maj = (s, forcer) => JSON.parse(s.ev(`JSON.stringify(majTauxAutomatique(${forcer ? 'true' : ''}))`));
const etat = (s) => s.api('taux.etat', {}, s.jetonAdmin).donnees;

test('Calcul : 655,957 ÷ 1,4723 = 445,5322 FCFA pour 1 CAD, taux A et B déduits', () => {
  const s = systemePret();
  const r = maj(s, true);
  assert.equal(r.statut, 'ENREGISTRE');
  assert.equal(r.tauxReference, '445.5322');
  const e = etat(s);
  assert.equal(e.actuel.source, 'AUTO');
  assert.equal(e.actuel.tauxFluxA, '435.5322'); // marge A d'exemple : 10
  assert.match(e.actuel.commentaire, /BCE du 2026-09-29 : 1 EUR = 1\.4723 CAD/);
  // Les transactions peuvent être simulées avec ce taux.
  assert.equal(s.api('transactions.simuler', { flux: 'A', montantCad: '100' }, s.jetonAdmin).ok, true);
});

test('Écart choisi par l\'Admin appliqué (taux « marché »)', () => {
  const s = systemePret();
  s.api('parametres.modifier', { cle: 'TAUX_AUTO_ECART_FCFA', valeur: '-3,5', justification: 'Taux marché Ouaga' }, s.jetonAdmin);
  assert.equal(maj(s, true).tauxReference, '442.0322');
});

test('Pas de doublon si le cours n\'a pas changé', () => {
  const s = systemePret();
  maj(s, true);
  assert.equal(maj(s).statut, 'INCHANGE');
  assert.equal(etat(s).historique.length, 1);
});

test('Une saisie manuelle reste prioritaire 24 h', () => {
  const s = systemePret();
  s.api('taux.saisir', { tauxReference: '447' }, s.jetonAdmin);
  assert.equal(maj(s).statut, 'MANUEL_PRIORITAIRE');
  assert.equal(etat(s).actuel.tauxReference, '447.0000');
  // Après 24 h, l'automatique reprend la main.
  s.ev(`modifierLigne_('Taux', dernierTaux_().Id, { DateUTC: new Date(Date.now() - 25 * 3600000).toISOString() })`);
  assert.equal(maj(s).statut, 'ENREGISTRE');
});

test('Source principale en panne : la source de secours est utilisée', () => {
  const s = systemePret();
  s.ctx.__internet['https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'] = { erreurReseau: true };
  s.ctx.__internet['https://api.frankfurter.app/latest?from=EUR&to=CAD'] = { code: 200, texte: '{"base":"EUR","date":"2026-09-29","rates":{"CAD":1.5}}' };
  const r = maj(s, true);
  assert.equal(r.statut, 'ENREGISTRE');
  assert.equal(r.tauxReference, '437.3047'); // 655,957 ÷ 1,5
  assert.match(r.commentaire, /Frankfurter/);
});

test('Toutes les sources en panne : rien n\'est enregistré, l\'échec est journalisé', () => {
  const s = systemePret();
  s.ctx.__internet['https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'] = { code: 500, texte: '' };
  assert.equal(maj(s, true).statut, 'ECHEC');
  assert.equal(etat(s).actuel, null);
  const actions = s.api('audit.lister', {}, s.jetonAdmin).donnees.entrees.map(e => e.Action);
  assert.ok(actions.includes('TAUX_AUTO_ECHEC'));
});

test('Cours anormal (erreur de la source) : refusé et journalisé', () => {
  const s = systemePret();
  maj(s, true);
  s.ctx.__internet['https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'] = { code: 200, texte: "<Cube time='2026-09-30'><Cube currency='CAD' rate='1.2'/></Cube>" };
  assert.equal(maj(s).statut, 'ECART_SUSPECT');
  assert.equal(etat(s).actuel.tauxReference, '445.5322');
  // Cours absurde : refusé par le contrôle de vraisemblance, puis source de secours absente → échec.
  s.ctx.__internet['https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'] = { code: 200, texte: "<Cube currency='CAD' rate='147.23'/>" };
  assert.equal(maj(s, true).statut, 'ECHEC');
});

test('Désactivable dans les paramètres ; la tâche planifiée ne force jamais', () => {
  const s = systemePret();
  s.api('parametres.modifier', { cle: 'TAUX_AUTO_ACTIF', valeur: 'NON', justification: 'test' }, s.jetonAdmin);
  assert.equal(maj(s, true).statut, 'DESACTIVE');
  s.api('parametres.modifier', { cle: 'TAUX_AUTO_ACTIF', valeur: 'OUI', justification: 'test' }, s.jetonAdmin);
  s.api('taux.saisir', { tauxReference: '447' }, s.jetonAdmin);
  // Google appelle la fonction avec un objet « événement » : cela ne doit pas forcer.
  assert.equal(JSON.parse(s.ev('JSON.stringify(majTauxAutomatique({ triggerUid: "x" }))')).statut, 'MANUEL_PRIORITAIRE');
});
