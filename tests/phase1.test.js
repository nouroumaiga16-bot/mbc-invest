/**
 * Tests automatiques — Phase 1 (connexion, rôles, paramètres, journal d'audit).
 * Lancer avec :  node --test tests/
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { systemePret, creerAgent } = require('./aide');

test('Installation : 16 onglets, paramètres, caisses, entités — relançable sans doublon', () => {
  const s = systemePret();
  const attendus = ['Utilisateurs', 'Sessions', 'Clients', 'Beneficiaires', 'Taux', 'Transactions',
    'HistoriqueStatuts', 'Caisses', 'MouvementsCaisse', 'Rapprochements', 'Depenses', 'Entites',
    'OperationsInternes', 'AlertesConformite', 'Parametres', 'JournalAudit'];
  attendus.forEach(n => assert.ok(s.ctx.__feuilles[n], 'onglet manquant : ' + n));
  const nbParams = s.ev("lireTable_('Parametres').length");
  s.ctx.installer(); // deuxième fois
  assert.equal(s.ev("lireTable_('Parametres').length"), nbParams);
  assert.equal(s.ev("lireTable_('Caisses').length"), 2);
  assert.equal(s.ev("lireTable_('Entites').length"), 2);
});

test('Un seul Admin initial peut être créé depuis le classeur', () => {
  const s = systemePret();
  s.ctx.__alertes.length = 0;
  s.ctx.creerAdministrateurInitial();
  assert.match(s.ctx.__alertes.join(), /existe déjà/);
});

test('Mot de passe incorrect refusé, message neutre (identifiant inconnu = même message)', () => {
  const s = systemePret();
  const a = s.api('auth.connexion', { identifiant: 'nourou', motDePasse: 'mauvais' });
  const b = s.api('auth.connexion', { identifiant: 'inconnu', motDePasse: 'mauvais' });
  assert.equal(a.ok, false);
  assert.equal(a.message, b.message);
});

test('Blocage du compte après 5 échecs, même avec le bon mot de passe ensuite', () => {
  const s = systemePret();
  for (let i = 0; i < 5; i++) s.api('auth.connexion', { identifiant: 'nourou', motDePasse: 'mauvais' });
  const r = s.api('auth.connexion', { identifiant: 'nourou', motDePasse: 'MonSecret2026' });
  assert.equal(r.code, 'COMPTE_BLOQUE');
});

test('Premier accès : obligation de changer le mot de passe avant tout le reste', () => {
  const s = systemePret();
  const cr = s.api('utilisateurs.creer', { identifiant: 'test.agent', nomComplet: 'Test', role: 'AGENT_OUAGA' }, s.jetonAdmin);
  const c = s.api('auth.connexion', { identifiant: 'test.agent', motDePasse: cr.donnees.motDePasseTemporaire });
  assert.equal(c.donnees.utilisateur.doitChangerMdp, true);
  assert.equal(s.api('parametres.lister', {}, c.donnees.jeton).code, 'MDP_A_CHANGER');
  const faible = s.api('auth.changerMotDePasse', { ancien: cr.donnees.motDePasseTemporaire, nouveau: 'court' }, c.donnees.jeton);
  assert.equal(faible.code, 'MDP_FAIBLE');
});

test('Rôles vérifiés côté serveur : un agent ne peut ni modifier les paramètres ni gérer les utilisateurs', () => {
  const s = systemePret();
  const agent = creerAgent(s);
  assert.equal(s.api('parametres.modifier', { cle: 'SESSION_DUREE_HEURES', valeur: '24', justification: 'x' }, agent.jeton).code, 'ACCES_REFUSE');
  assert.equal(s.api('utilisateurs.lister', {}, agent.jeton).code, 'ACCES_REFUSE');
  assert.equal(s.api('audit.lister', {}, agent.jeton).code, 'ACCES_REFUSE');
  // L'agent ne voit que les paramètres « boutique ».
  const p = s.api('parametres.lister', {}, agent.jeton);
  assert.ok(p.donnees.length > 0);
  p.donnees.forEach(x => assert.match(x.cle, /^BOUTIQUE_/));
  assert.ok(!p.donnees.some(x => x.cle.indexOf('MARGE') !== -1));
});

test('Paramètres : validation, justification obligatoire, journalisation ancienne/nouvelle valeur', () => {
  const s = systemePret();
  assert.equal(s.api('parametres.modifier', { cle: 'DECLARATION_SEUIL_CAD', valeur: 'abc', justification: 'test' }, s.jetonAdmin).code, 'MONTANT_INVALIDE');
  assert.equal(s.api('parametres.modifier', { cle: 'DECLARATION_SEUIL_CAD', valeur: '9000' }, s.jetonAdmin).code, 'CHAMP_OBLIGATOIRE');
  const ok = s.api('parametres.modifier', { cle: 'DECLARATION_SEUIL_CAD', valeur: '9 000,5', justification: 'Avis du conseiller' }, s.jetonAdmin);
  assert.equal(ok.donnees.valeur, '9000.50');
  const j = s.api('audit.lister', { action: 'PARAMETRE_MODIFIE' }, s.jetonAdmin).donnees.entrees[0];
  assert.equal(JSON.parse(j.AncienneValeur).Valeur, '10000.00');
  assert.equal(JSON.parse(j.NouvelleValeur).Valeur, '9000.50');
  assert.match(j.Details, /Avis du conseiller/);
});

test('Aucun mot de passe ni jeton en clair dans le classeur', () => {
  const s = systemePret();
  const tout = JSON.stringify(s.ctx.__feuilles.Sessions._donnees) + JSON.stringify(s.ctx.__feuilles.Utilisateurs._donnees) +
    JSON.stringify(s.ctx.__feuilles.JournalAudit._donnees);
  assert.ok(tout.indexOf(s.jetonAdmin) === -1, 'jeton trouvé en clair');
  assert.ok(tout.indexOf('MonSecret2026') === -1, 'mot de passe trouvé en clair');
  assert.ok(tout.indexOf(s.mdpTemp) === -1, 'mot de passe temporaire trouvé en clair');
});

test('Session expirée refusée ; déconnexion ferme la session', () => {
  const s = systemePret();
  const c = s.api('auth.connexion', { identifiant: 'nourou', motDePasse: 'MonSecret2026' });
  assert.equal(s.api('auth.moi', {}, c.donnees.jeton).ok, true);
  s.ev("modifierLigne_('Sessions', lireTable_('Sessions').pop().Id, { ExpireLe: '2020-01-01T00:00:00.000Z' })");
  assert.equal(s.api('auth.moi', {}, c.donnees.jeton).code, 'SESSION_INVALIDE');
  s.api('auth.deconnexion', {}, s.jetonAdmin);
  assert.equal(s.api('auth.moi', {}, s.jetonAdmin).code, 'SESSION_INVALIDE');
});

test('Désactivation d\'un agent : ses sessions sont coupées immédiatement', () => {
  const s = systemePret();
  const agent = creerAgent(s);
  assert.equal(s.api('utilisateurs.modifier', { id: agent.id, actif: false }, s.jetonAdmin).ok, true);
  assert.equal(s.api('auth.moi', {}, agent.jeton).code, 'SESSION_INVALIDE');
});

test('Le dernier Admin ne peut pas être désactivé ni se retirer ses droits', () => {
  const s = systemePret();
  const moi = s.api('auth.moi', {}, s.jetonAdmin).donnees.utilisateur.id;
  assert.equal(s.api('utilisateurs.modifier', { id: moi, actif: false }, s.jetonAdmin).code, 'INTERDIT');
  assert.equal(s.api('utilisateurs.modifier', { id: moi, role: 'AGENT_OUAGA' }, s.jetonAdmin).code, 'INTERDIT');
});

test('Journal d\'audit : intact, puis modification manuelle détectée', () => {
  const s = systemePret();
  let r = s.api('audit.verifierIntegrite', {}, s.jetonAdmin);
  assert.equal(r.donnees.integre, true, r.donnees.message);
  // Quelqu'un modifie une ligne à la main dans le classeur…
  const lignes = s.ctx.__feuilles.JournalAudit._donnees;
  const colAction = lignes[0].indexOf('Action');
  lignes[2][colAction] = 'FALSIFIE';
  r = s.api('audit.verifierIntegrite', {}, s.jetonAdmin);
  assert.equal(r.donnees.integre, false);
  assert.match(r.donnees.message, /ligne 3/);
});

test('Journal d\'audit : suppression d\'une ligne détectée', () => {
  const s = systemePret();
  s.ctx.__feuilles.JournalAudit._donnees.splice(2, 1);
  const r = s.api('audit.verifierIntegrite', {}, s.jetonAdmin);
  assert.equal(r.donnees.integre, false);
});

test('Montants : calculs en entiers, formats stricts', () => {
  const s = systemePret();
  assert.equal(s.ev("cadVersCentimes_('1 250,50')"), 125050);
  assert.equal(s.ev("cadVersCentimes_('0.1')"), 10);
  assert.equal(s.ev("centimesVersTexte_(125050)"), '1250.50');
  assert.equal(s.ev("fcfaVersEntier_('512 500')"), 512500);
  assert.throws(() => s.ev("cadVersCentimes_('1.005')"));
  assert.throws(() => s.ev("cadVersCentimes_('-5')"));
  assert.throws(() => s.ev("fcfaVersEntier_('512.5')"));
});

test('Protection contre l\'injection de formules dans le classeur', () => {
  const s = systemePret();
  assert.equal(s.ev("valeurSure_('=IMPORTXML(\"http://x\")')"), '\'=IMPORTXML("http://x")');
  assert.equal(s.ev("valeurSure_('-500')"), '-500');
  assert.equal(s.ev("valeurSure_('+226 70 00 00 00')"), '\'+226 70 00 00 00');
});

test('Action inconnue et demande illisible refusées proprement', () => {
  const s = systemePret();
  assert.equal(s.api('systeme.toutEffacer', {}, s.jetonAdmin).code, 'ACTION_INCONNUE');
  assert.equal(s.ctx.traiterDemande_('pas du json').code, 'REQUETE_INVALIDE');
  assert.equal(s.api('parametres.lister', {}, 'faux-jeton-000000000000000000000000000').code, 'SESSION_INVALIDE');
});
