/**
 * Tests automatiques — Phase 2 (clients, bénéficiaires, KYC, photos).
 * Lancer avec :  npm test
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { systemePret, creerAgent } = require('./aide');

// Fausse photo JPEG (les 3 premiers octets suffisent à la reconnaître).
const JPEG = { mime: 'image/jpeg', base64: Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(40).fill(1)]).toString('base64') };
const PAS_UNE_IMAGE = { mime: 'image/jpeg', base64: Buffer.from('<script>alert(1)</script> ceci est du texte').toString('base64') };

/** Date AAAA-MM-JJ décalée de n jours par rapport à aujourd'hui. */
const dansJours = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

function donneesClient(extra) {
  return Object.assign({
    nomComplet: 'Aminata Ouédraogo', dateNaissance: '1990-04-12', adresse: '1200 rue Sherbrooke',
    ville: 'Montréal', pays: 'Canada', telephone: '+1 514 555 0101', profession: 'Infirmière',
    typePiece: 'PASSEPORT', numeroPiece: 'b1234567', expirationPiece: dansJours(400), paysEmissionPiece: 'Burkina Faso'
  }, extra || {});
}

/** Crée un client et renvoie son id (échoue le test si refusé). */
function creerClient(s, extra) {
  const r = s.api('clients.creer', donneesClient(extra), s.jetonAdmin);
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.donnees.id;
}

test('Création d\'un client : numéro lisible, statut Nouveau, champs normalisés', () => {
  const s = systemePret();
  const r = s.api('clients.creer', donneesClient(), s.jetonAdmin);
  assert.equal(r.donnees.numeroClient, 'CLI-000001');
  const f = s.api('clients.fiche', { id: r.donnees.id }, s.jetonAdmin).donnees;
  assert.equal(f.client.statut, 'Nouveau');
  assert.equal(f.client.telephone, '+15145550101');
  assert.equal(f.client.numeroPiece, 'B1234567');
  const r2 = s.api('clients.creer', donneesClient({ typePiece: 'CNIB', numeroPiece: 'X99' }), s.jetonAdmin);
  assert.equal(r2.donnees.numeroClient, 'CLI-000002');
  assert.match(r2.donnees.avertissements.join(), /Même téléphone/);
});

test('Champs obligatoires et formats contrôlés côté serveur', () => {
  const s = systemePret();
  const essai = (extra) => s.api('clients.creer', donneesClient(extra), s.jetonAdmin).code;
  assert.equal(essai({ profession: '' }), 'CHAMP_OBLIGATOIRE');
  assert.equal(essai({ telephone: '12' }), 'TELEPHONE_INVALIDE');
  assert.equal(essai({ dateNaissance: '1990-02-30' }), 'DATE_INVALIDE');
  assert.equal(essai({ dateNaissance: dansJours(-365 * 10) }), 'CLIENT_MINEUR');
  assert.equal(essai({ typePiece: 'CARTE_ETUDIANT' }), 'PIECE_INVALIDE');
  assert.equal(essai({ typePiece: 'AUTRE' }), 'CHAMP_OBLIGATOIRE'); // préciser le type
  assert.equal(essai({ email: 'pas-un-courriel' }), 'EMAIL_INVALIDE');
});

test('Pièce d\'identité en double refusée (même avec espaces ou minuscules)', () => {
  const s = systemePret();
  creerClient(s);
  const r = s.api('clients.creer', donneesClient({ nomComplet: 'Autre personne', numeroPiece: 'B 123 4567' }), s.jetonAdmin);
  assert.equal(r.code, 'CLIENT_EN_DOUBLE');
  assert.match(r.message, /CLI-000001/);
});

test('Vérification : refusée sans photo, sans confirmation ou avec pièce expirée', () => {
  const s = systemePret();
  const id = creerClient(s);
  assert.equal(s.api('clients.verifier', { id, confirmation: true }, s.jetonAdmin).code, 'KYC_INCOMPLET');
  assert.equal(s.api('clients.televerserPhoto', { id, face: 'recto', photo: JPEG }, s.jetonAdmin).ok, true);
  assert.equal(s.api('clients.verifier', { id }, s.jetonAdmin).code, 'CONFIRMATION_REQUISE');
  assert.equal(s.api('clients.verifier', { id, confirmation: true }, s.jetonAdmin).ok, true); // passeport : recto suffit
  assert.equal(s.api('clients.fiche', { id }, s.jetonAdmin).donnees.client.statut, 'Vérifié');

  const id2 = creerClient(s, { typePiece: 'CNIB', numeroPiece: 'C555', expirationPiece: dansJours(-1) });
  s.api('clients.televerserPhoto', { id: id2, face: 'recto', photo: JPEG }, s.jetonAdmin);
  let r = s.api('clients.verifier', { id: id2, confirmation: true }, s.jetonAdmin);
  assert.equal(r.code, 'KYC_INCOMPLET');
  assert.match(r.message, /verso/);
  assert.match(r.message, /expirée/);
});

test('Photo : fichier qui n\'est pas une image refusé ; image enregistrée dans Drive et relisible', () => {
  const s = systemePret();
  const id = creerClient(s);
  assert.equal(s.api('clients.televerserPhoto', { id, face: 'recto', photo: PAS_UNE_IMAGE }, s.jetonAdmin).code, 'PHOTO_FORMAT');
  assert.equal(s.api('clients.televerserPhoto', { id, face: 'recto', photo: { mime: 'application/pdf', base64: 'AAAA' } }, s.jetonAdmin).code, 'PHOTO_FORMAT');
  s.api('clients.televerserPhoto', { id, face: 'recto', photo: JPEG }, s.jetonAdmin);
  const p = s.api('clients.photo', { id, face: 'recto' }, s.jetonAdmin);
  assert.equal(p.donnees.mime, 'image/jpeg');
  assert.equal(p.donnees.base64, JPEG.base64);
  // Rangée dans le sous-dossier du client, avec son numéro dans le nom.
  const noms = Object.values(s.ctx.__fichiers).map(f => f.getName());
  assert.ok(noms.some(n => /^CLI-000001_piece_recto_/.test(n)), noms.join());
});

test('Changer l\'identité d\'un client vérifié le fait repasser à « Nouveau »', () => {
  const s = systemePret();
  const id = creerClient(s);
  s.api('clients.televerserPhoto', { id, face: 'recto', photo: JPEG }, s.jetonAdmin);
  s.api('clients.verifier', { id, confirmation: true }, s.jetonAdmin);
  // Changer l'adresse ne touche pas au statut…
  let r = s.api('clients.modifier', { id, adresse: '15 avenue du Parc' }, s.jetonAdmin);
  assert.equal(r.donnees.doitEtreReverifie, false);
  assert.equal(s.api('clients.fiche', { id }, s.jetonAdmin).donnees.client.statut, 'Vérifié');
  // … mais changer le numéro de pièce, oui.
  r = s.api('clients.modifier', { id, numeroPiece: 'B7654321' }, s.jetonAdmin);
  assert.equal(r.donnees.doitEtreReverifie, true);
  assert.equal(s.api('clients.fiche', { id }, s.jetonAdmin).donnees.client.statut, 'Nouveau');
});

test('Blocage : motif obligatoire ; déblocage = retour à « Nouveau »', () => {
  const s = systemePret();
  const id = creerClient(s);
  assert.equal(s.api('clients.bloquer', { id }, s.jetonAdmin).code, 'CHAMP_OBLIGATOIRE');
  assert.equal(s.api('clients.bloquer', { id, motif: 'Contestation de virement' }, s.jetonAdmin).ok, true);
  assert.equal(s.api('clients.verifier', { id, confirmation: true }, s.jetonAdmin).code, 'CLIENT_BLOQUE');
  assert.equal(s.api('clients.debloquer', { id, motif: 'Dossier réglé' }, s.jetonAdmin).ok, true);
  assert.equal(s.api('clients.fiche', { id }, s.jetonAdmin).donnees.client.statut, 'Nouveau');
});

test('Contrôle KYC d\'une transaction : pièce expirée, client bloqué, non vérifié au-dessus du seuil', () => {
  const s = systemePret();
  const id = creerClient(s);
  const controle = (montant) => JSON.parse(s.ev(`JSON.stringify(controleKycTransaction_(trouverParId_("Clients", "${id}"), ${montant}))`));
  // Nouveau client, 500 CAD : sous le seuil de 1 000 CAD → autorisé.
  assert.equal(controle(50000).autorise, true);
  // 1 500 CAD : non vérifié au-dessus du seuil → bloqué.
  assert.deepEqual(controle(150000).motifs.map(m => m.code), ['CLIENT_NON_VERIFIE']);
  // Fractionnement : 800 CAD déjà envoyés dans les 24 h + 300 CAD → cumul 1 100 CAD → bloqué.
  s.ev(`ajouterLigne_('Transactions', { Id: 'T1', ClientId: '${id}', Statut: 'Validée', MontantCadCentimes: '80000', CreeLe: maintenantUTC_() })`);
  assert.deepEqual(controle(30000).motifs.map(m => m.code), ['CLIENT_NON_VERIFIE']);
  // Une transaction annulée ne compte pas.
  s.ev(`modifierLigne_('Transactions', 'T1', { Statut: 'Annulée' })`);
  assert.equal(controle(30000).autorise, true);
  // Pièce expirée : bloquée quel que soit le montant.
  s.ev(`modifierLigne_('Clients', '${id}', { ExpirationPiece: '2020-01-01' })`);
  assert.deepEqual(controle(1000).motifs.map(m => m.code), ['PIECE_EXPIREE']);
  // Client bloqué.
  s.api('clients.bloquer', { id, motif: 'Test' }, s.jetonAdmin);
  assert.ok(controle(1000).motifs.some(m => m.code === 'CLIENT_BLOQUE'));
});

test('Totaux 30 jours / 12 mois dans la fiche', () => {
  const s = systemePret();
  const id = creerClient(s);
  const ilYa = (j) => new Date(Date.now() - j * 86400000).toISOString();
  s.ev(`ajouterLigne_('Transactions', { Id: 'T1', ClientId: '${id}', Statut: 'Clôturée', MontantCadCentimes: '10000', CreeLe: '${ilYa(5)}' })`);
  s.ev(`ajouterLigne_('Transactions', { Id: 'T2', ClientId: '${id}', Statut: 'Clôturée', MontantCadCentimes: '20000', CreeLe: '${ilYa(100)}' })`);
  s.ev(`ajouterLigne_('Transactions', { Id: 'T3', ClientId: '${id}', Statut: 'Clôturée', MontantCadCentimes: '40000', CreeLe: '${ilYa(400)}' })`);
  s.ev(`ajouterLigne_('Transactions', { Id: 'T4', ClientId: '${id}', Statut: 'Brouillon', MontantCadCentimes: '99900', CreeLe: '${ilYa(1)}' })`);
  const f = s.api('clients.fiche', { id }, s.jetonAdmin).donnees;
  assert.equal(f.totaux.total30jCentimes, 10000);
  assert.equal(f.totaux.total12mCentimes, 30000);
  assert.equal(f.transactions.length, 4);
  assert.equal(f.transactions[0].id, 'T4'); // plus récente en premier
});

test('Recherche par nom, téléphone, numéro client ou numéro de pièce', () => {
  const s = systemePret();
  creerClient(s);
  creerClient(s, { nomComplet: 'Moussa Traoré', telephone: '+226 70 11 22 33', typePiece: 'CNIB', numeroPiece: 'B9988776' });
  const cherche = (q) => s.api('clients.lister', { recherche: q }, s.jetonAdmin).donnees.map(c => c.nomComplet);
  assert.deepEqual(cherche('moussa'), ['Moussa Traoré']);
  assert.deepEqual(cherche('70 11 22'), ['Moussa Traoré']);
  assert.deepEqual(cherche('CLI-000001'), ['Aminata Ouédraogo']);
  assert.deepEqual(cherche('b998'), ['Moussa Traoré']);
  assert.equal(cherche('').length, 2);
});

test('Bénéficiaires : création, doublon refusé, désactivation réservée à l\'Admin', () => {
  const s = systemePret();
  const id = creerClient(s);
  const b = { clientId: id, nomComplet: 'Salif Ouédraogo', telephone: '+22670000001', ville: 'Ouagadougou', pays: 'Burkina Faso', lienClient: 'Frère' };
  const r = s.api('beneficiaires.creer', b, s.jetonAdmin);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(s.api('beneficiaires.creer', b, s.jetonAdmin).code, 'BENEFICIAIRE_EN_DOUBLE');
  assert.equal(s.api('beneficiaires.creer', Object.assign({}, b, { lienClient: '' }), s.jetonAdmin).code, 'CHAMP_OBLIGATOIRE');
  const agent = creerAgent(s);
  assert.equal(s.api('beneficiaires.modifier', { id: r.donnees.id, actif: false }, agent.jeton).code, 'ACCES_REFUSE');
  assert.equal(s.api('beneficiaires.modifier', { id: r.donnees.id, actif: false }, s.jetonAdmin).ok, true);
  assert.equal(s.api('clients.fiche', { id }, s.jetonAdmin).donnees.beneficiaires[0].actif, false);
});

test('Droits : un agent crée des clients mais ne vérifie pas, ne bloque pas, ne voit pas les photos', () => {
  const s = systemePret();
  const agent = creerAgent(s);
  const r = s.api('clients.creer', donneesClient(), agent.jeton);
  assert.equal(r.ok, true);
  const id = r.donnees.id;
  assert.equal(s.api('clients.televerserPhoto', { id, face: 'recto', photo: JPEG }, agent.jeton).ok, true);
  assert.equal(s.api('clients.photo', { id, face: 'recto' }, agent.jeton).code, 'ACCES_REFUSE');
  assert.equal(s.api('clients.verifier', { id, confirmation: true }, agent.jeton).code, 'ACCES_REFUSE');
  assert.equal(s.api('clients.bloquer', { id, motif: 'x' }, agent.jeton).code, 'ACCES_REFUSE');
  // Une fois vérifié par l'Admin, l'agent ne peut plus modifier la fiche.
  s.api('clients.verifier', { id, confirmation: true }, s.jetonAdmin);
  assert.equal(s.api('clients.modifier', { id, adresse: 'ailleurs' }, agent.jeton).code, 'ACCES_REFUSE');
});

test('Journal : création, vérification, blocage et consultation des photos sont tracés', () => {
  const s = systemePret();
  const id = creerClient(s);
  s.api('clients.televerserPhoto', { id, face: 'recto', photo: JPEG }, s.jetonAdmin);
  s.api('clients.photo', { id, face: 'recto' }, s.jetonAdmin);
  s.api('clients.verifier', { id, confirmation: true }, s.jetonAdmin);
  s.api('clients.bloquer', { id, motif: 'Test' }, s.jetonAdmin);
  const actions = s.api('audit.lister', { parPage: 200 }, s.jetonAdmin).donnees.entrees.map(e => e.Action);
  ['CLIENT_CREE', 'CLIENT_PHOTO_AJOUTEE', 'CLIENT_PHOTO_CONSULTEE', 'CLIENT_VERIFIE', 'CLIENT_BLOQUE']
    .forEach(a => assert.ok(actions.includes(a), 'manque ' + a));
  assert.equal(s.api('audit.verifierIntegrite', {}, s.jetonAdmin).donnees.integre, true);
});
