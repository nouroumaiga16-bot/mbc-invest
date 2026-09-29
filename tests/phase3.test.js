/**
 * Tests automatiques — Phase 3 (taux, transactions, règles anti-pertes).
 * Lancer avec :  npm test
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { systemePret } = require('./aide');

const JPEG = { mime: 'image/jpeg', base64: Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(40).fill(1)]).toString('base64') };
const dansJours = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

/** Système avec un taux (440 FCFA/CAD, marges 10), un client vérifié et un bénéficiaire. */
function systemeAvecClient(options) {
  const s = systemePret();
  const A = (action, d) => s.api(action, d, s.jetonAdmin);
  s.A = A;
  assert.equal(A('taux.saisir', { tauxReference: '440' }).ok, true);
  const c = A('clients.creer', {
    nomComplet: 'Aminata Ouédraogo', dateNaissance: '1990-04-12', adresse: '1200 rue Sherbrooke', ville: 'Montréal',
    pays: 'Canada', telephone: '+15145550101', profession: 'Infirmière', typePiece: 'PASSEPORT',
    numeroPiece: 'B1234567', expirationPiece: dansJours(400), paysEmissionPiece: 'Burkina Faso', photoRecto: JPEG
  });
  s.clientId = c.donnees.id;
  if (!options || options.verifie !== false) assert.equal(A('clients.verifier', { id: s.clientId, confirmation: true }).ok, true);
  s.benefId = A('beneficiaires.creer', { clientId: s.clientId, nomComplet: 'Salif Ouédraogo', telephone: '+22670000001',
    ville: 'Ouagadougou', pays: 'Burkina Faso', lienClient: 'Frère' }).donnees.id;
  return s;
}

function creer(s, flux, montant, extra) {
  return s.A('transactions.creer', Object.assign({ flux, clientId: s.clientId, beneficiaireId: s.benefId, montantCad: montant,
    provenanceFonds: 'Salaire', motifTransfert: 'Aide familiale' }, extra || {}));
}

/** Supprime le délai de sécurité (simule le passage du temps). */
function passerDelai(s, id) {
  s.ev(`modifierLigne_('Transactions', '${id}', { PayableApres: '2000-01-01T00:00:00.000Z' })`);
}

test('Taux : A = référence − marge, B = référence + marge ; écart suspect à confirmer', () => {
  const s = systemeAvecClient();
  const e = s.A('taux.etat', {}).donnees;
  assert.equal(e.actuel.tauxFluxA, '430.0000');
  assert.equal(e.actuel.tauxFluxB, '450.0000');
  assert.equal(s.A('taux.saisir', { tauxReference: '480' }).code, 'TAUX_ECART');
  assert.equal(s.A('taux.saisir', { tauxReference: '480', confirmerEcart: true }).ok, true);
  assert.equal(s.A('taux.saisir', { tauxReference: '441,2567' , confirmerEcart: true}).donnees.tauxReference, '441.2567');
  assert.equal(s.A('taux.saisir', { tauxReference: 'abc' }).code, 'TAUX_INVALIDE');
});

test('Marge en pourcentage', () => {
  const s = systemePret();
  s.api('parametres.modifier', { cle: 'MARGE_A_TYPE', valeur: 'POURCENT', justification: 'test' }, s.jetonAdmin);
  s.api('parametres.modifier', { cle: 'MARGE_A_VALEUR', valeur: '2', justification: 'test' }, s.jetonAdmin);
  const r = s.api('taux.saisir', { tauxReference: '450' }, s.jetonAdmin).donnees;
  assert.equal(r.tauxFluxA, '441.0000'); // 450 − 2 %
});

test('Sans taux, ou taux de plus de 24 h : création de transaction bloquée', () => {
  const s = systemeAvecClient();
  s.ev(`modifierLigne_('Taux', lireTable_('Taux')[0].Id, { DateUTC: '2020-01-01T00:00:00.000Z' })`);
  assert.equal(creer(s, 'A', '100').code, 'TAUX_PERIME');
});

test('Calcul flux A et B en entiers, frais par tranche, revenu brut', () => {
  const s = systemeAvecClient();
  const a = s.A('transactions.simuler', { flux: 'A', montantCad: '500' }).donnees;
  assert.equal(a.montantFcfa, 215000);            // 500 × 430
  assert.equal(a.fraisCadCentimes, 500);          // tranche ≤ 500 CAD : 5 CAD
  assert.equal(a.totalClientCadCentimes, 50500);
  assert.equal(a.revenuBrutCadCentimes, 50500 - 48864); // 215 000 FCFA valent 488,64 CAD au taux 440 (arrondi au-dessus)
  const b = s.A('transactions.simuler', { flux: 'B', montantCad: '1000' }).donnees;
  assert.equal(b.montantFcfa, 450000);            // 1 000 × 450
  assert.equal(b.fraisFcfa, 4500);                // 10 CAD × 450
  assert.equal(b.totalClientFcfa, 454500);
  assert.equal(b.revenuBrutCadCentimes, 103295 - 100000);
  const c = s.A('transactions.simuler', { flux: 'A', montantCad: '123,45' }).donnees;
  assert.equal(c.montantFcfa, 53083);             // 123,45 × 430 = 53 083,5 → arrondi en faveur de la caisse
});

test('Code de retrait : 6 chiffres, affiché une seule fois, jamais stocké en clair', () => {
  const s = systemeAvecClient();
  const r = creer(s, 'A', '100').donnees;
  assert.match(r.codeRetrait, /^\d{6}$/);
  assert.match(r.numero, /^MBT-\d{4}-000001$/);
  const tout = JSON.stringify(s.ctx.__feuilles.Transactions._donnees) + JSON.stringify(s.ctx.__feuilles.JournalAudit._donnees);
  assert.ok(tout.indexOf('"' + r.codeRetrait + '"') === -1);
  assert.equal(s.A('transactions.fiche', { id: r.id }).donnees.codeRetrait, undefined);
});

test('Jamais de paiement avant « Paiement confirmé »', () => {
  const s = systemeAvecClient();
  s.A('caisses.fondsRoulement', { devise: 'FCFA', type: 'APPORT', montant: '1000000', commentaire: 'Départ' });
  const r = creer(s, 'A', '100').donnees;
  assert.equal(s.A('transactions.autoriserRemise', { id: r.id, codeRetrait: r.codeRetrait, pieceBeneficiaireNumero: 'X1' }).code, 'STATUT_INVALIDE');
  assert.equal(s.A('transactions.marquerPayee', { id: r.id, photoPreuve: JPEG }).code, 'STATUT_INVALIDE');
  assert.equal(s.A('transactions.valider', { id: r.id }).code, 'STATUT_INVALIDE');
});

test('Référence de paiement obligatoire et utilisable une seule fois', () => {
  const s = systemeAvecClient();
  const r1 = creer(s, 'A', '100').donnees;
  const r2 = creer(s, 'A', '100').donnees;
  assert.equal(s.A('transactions.confirmerPaiement', { id: r1.id }).code, 'CHAMP_OBLIGATOIRE');
  assert.equal(s.A('transactions.confirmerPaiement', { id: r1.id, referencePaiement: 'CA1234' }).ok, true);
  assert.equal(s.A('transactions.confirmerPaiement', { id: r2.id, referencePaiement: 'ca1234' }).code, 'REFERENCE_DEJA_UTILISEE');
  assert.equal(s.A('caisses.etat', {}).donnees.cad.reelCentimes, 10500); // 100 CAD + 5 CAD de frais encaissés
});

test('Solde insuffisant : validation refusée, en tenant compte des montants déjà promis', () => {
  const s = systemeAvecClient();
  const r1 = creer(s, 'A', '500').donnees;  // 215 000 FCFA à payer
  const r2 = creer(s, 'A', '500').donnees;
  s.A('transactions.confirmerPaiement', { id: r1.id, referencePaiement: 'R1' });
  s.A('transactions.confirmerPaiement', { id: r2.id, referencePaiement: 'R2' });
  assert.equal(s.A('transactions.valider', { id: r1.id }).code, 'SOLDE_INSUFFISANT'); // caisse FCFA vide
  s.A('caisses.fondsRoulement', { devise: 'FCFA', type: 'APPORT', montant: '300000', commentaire: 'Apport' });
  assert.equal(s.A('transactions.valider', { id: r1.id }).ok, true);
  // 300 000 − 215 000 promis = 85 000 disponibles < 215 000 → refus
  assert.equal(s.A('transactions.valider', { id: r2.id }).code, 'SOLDE_INSUFFISANT');
  const etat = s.A('caisses.etat', {}).donnees.fcfa;
  assert.equal(etat.promis, 215000);
  assert.equal(etat.disponible, 85000);
  // Un retrait ne peut pas toucher l'argent promis.
  assert.equal(s.A('caisses.fondsRoulement', { devise: 'FCFA', type: 'RETRAIT', montant: '100000', commentaire: 'x' }).code, 'SOLDE_INSUFFISANT');
});

test('Parcours complet flux A : délai nouveau client, code faux, remise, preuve, double paiement impossible', () => {
  const s = systemeAvecClient();
  s.A('caisses.fondsRoulement', { devise: 'FCFA', type: 'APPORT', montant: '1000000', commentaire: 'Départ' });
  const r = creer(s, 'A', '500').donnees;
  s.A('transactions.confirmerPaiement', { id: r.id, referencePaiement: 'INTERAC-1' });
  assert.equal(s.A('transactions.valider', { id: r.id }).ok, true);
  const autoriser = (code) => s.A('transactions.autoriserRemise', { id: r.id, codeRetrait: code, pieceBeneficiaireNumero: 'b777' });
  // Nouveau client : 24 h de délai de sécurité.
  assert.equal(autoriser(r.codeRetrait).code, 'DELAI_SECURITE');
  passerDelai(s, r.id);
  const faux = r.codeRetrait === '000000' ? '111111' : '000000';
  assert.equal(autoriser(faux).code, 'CODE_FAUX');
  const ok = autoriser(r.codeRetrait);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.match(ok.donnees.message, /215 000 FCFA/);
  assert.match(ok.donnees.message, /B777/);
  assert.match(ok.donnees.lienWhatsApp, /^https:\/\/wa\.me\/226/);
  assert.equal(s.A('transactions.marquerPayee', { id: r.id }).code, 'PREUVE_MANQUANTE');
  assert.equal(s.A('transactions.marquerPayee', { id: r.id, photoPreuve: JPEG }).ok, true);
  // Deuxième paiement de la même transaction : refusé.
  assert.equal(s.A('transactions.marquerPayee', { id: r.id, photoPreuve: JPEG }).code, 'STATUT_INVALIDE');
  assert.equal(s.A('caisses.etat', {}).donnees.fcfa.reel, 1000000 - 215000);
  assert.equal(s.A('transactions.cloturer', { id: r.id }).ok, true);
  const f = s.A('transactions.fiche', { id: r.id }).donnees;
  assert.equal(f.statut, 'Clôturée');
  assert.deepEqual(f.historique.map(h => h.vers),
    ['En attente de paiement', 'Paiement confirmé', 'Validée', 'Remise autorisée', 'Payée au bénéficiaire', 'Clôturée']);
  assert.equal(f.revenuBrutCadCentimes, 50500 - 48864);
});

test('5 codes de retrait faux : transaction bloquée', () => {
  const s = systemeAvecClient();
  s.A('caisses.fondsRoulement', { devise: 'FCFA', type: 'APPORT', montant: '1000000', commentaire: 'Départ' });
  const r = creer(s, 'A', '100').donnees;
  s.A('transactions.confirmerPaiement', { id: r.id, referencePaiement: 'R1' });
  s.A('transactions.valider', { id: r.id });
  passerDelai(s, r.id);
  const faux = r.codeRetrait === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) s.A('transactions.autoriserRemise', { id: r.id, codeRetrait: faux, pieceBeneficiaireNumero: 'X' });
  assert.equal(s.A('transactions.fiche', { id: r.id }).donnees.statut, 'Bloquée conformité');
  assert.equal(s.A('transactions.autoriserRemise', { id: r.id, codeRetrait: r.codeRetrait, pieceBeneficiaireNumero: 'X' }).code, 'STATUT_INVALIDE');
});

test('Flux B : FCFA encaissés à Larlé, virement Interac envoyé avec référence', () => {
  const s = systemeAvecClient();
  s.A('caisses.fondsRoulement', { devise: 'CAD', type: 'APPORT', montant: '5000', commentaire: 'Départ' });
  const r = creer(s, 'B', '1000').donnees;
  assert.equal(r.codeRetrait, '');
  s.A('transactions.confirmerPaiement', { id: r.id, referencePaiement: 'RECU-LARLE-01' });
  assert.equal(s.A('caisses.etat', {}).donnees.fcfa.reel, 454500);
  assert.equal(s.A('transactions.valider', { id: r.id }).ok, true);
  passerDelai(s, r.id);
  assert.equal(s.A('transactions.marquerPayee', { id: r.id }).code, 'CHAMP_OBLIGATOIRE');
  assert.equal(s.A('transactions.marquerPayee', { id: r.id, referenceVersement: 'CAxyz' }).ok, true);
  assert.equal(s.A('caisses.etat', {}).donnees.cad.reelCentimes, 400000);
});

test('Gros montant : mot de passe et contrôles obligatoires pour valider', () => {
  const s = systemeAvecClient();
  s.A('caisses.fondsRoulement', { devise: 'FCFA', type: 'APPORT', montant: '5000000', commentaire: 'Départ' });
  const r = creer(s, 'A', '4000').donnees;
  s.A('transactions.confirmerPaiement', { id: r.id, referencePaiement: 'GROS-1' });
  const tous = { paiementVu: true, identiteVerifiee: true, montantVerifie: true };
  assert.equal(s.A('transactions.valider', { id: r.id }).code, 'CONFIRMATION_REQUISE');
  assert.equal(s.A('transactions.valider', { id: r.id, controles: tous, motDePasse: 'mauvais' }).code, 'MDP_INCORRECT');
  assert.equal(s.A('transactions.valider', { id: r.id, controles: tous, motDePasse: 'MonSecret2026' }).ok, true);
});

test('KYC appliqué à la création : client non vérifié au-dessus du seuil, provenance obligatoire', () => {
  const s = systemeAvecClient({ verifie: false });
  assert.equal(creer(s, 'A', '900').ok, true);
  const r = creer(s, 'A', '200'); // cumul 24 h : 1 100 CAD > 1 000 CAD
  assert.equal(r.code, 'KYC_BLOQUANT');
  s.A('clients.verifier', { id: s.clientId, confirmation: true });
  assert.equal(creer(s, 'A', '1500', { provenanceFonds: '' }).code, 'CHAMP_OBLIGATOIRE');
  assert.equal(creer(s, 'A', '1500').ok, true);
});

test('Annulation seulement avant paiement ; remboursement rend l\'argent et libère la caisse', () => {
  const s = systemeAvecClient();
  const r = creer(s, 'A', '100').donnees;
  assert.equal(s.A('transactions.annuler', { id: r.id }).code, 'CHAMP_OBLIGATOIRE');
  s.A('transactions.confirmerPaiement', { id: r.id, referencePaiement: 'R9' });
  assert.equal(s.A('transactions.annuler', { id: r.id, motif: 'Erreur' }).code, 'STATUT_INVALIDE');
  assert.equal(s.A('transactions.rembourser', { id: r.id, motif: 'Client a changé d\'avis', reference: 'REMB-1' }).ok, true);
  assert.equal(s.A('caisses.etat', {}).donnees.cad.reelCentimes, 0);
  const r2 = creer(s, 'A', '100').donnees;
  assert.equal(s.A('transactions.annuler', { id: r2.id, motif: 'Doublon' }).ok, true);
  assert.equal(s.A('transactions.fiche', { id: r2.id }).donnees.statut, 'Annulée');
});

test('Le taux est verrouillé : changer le taux après création ne change pas la transaction', () => {
  const s = systemeAvecClient();
  const r = creer(s, 'A', '100').donnees;
  s.A('taux.saisir', { tauxReference: '400', confirmerEcart: true });
  const f = s.A('transactions.fiche', { id: r.id }).donnees;
  assert.equal(f.tauxApplique, '430.0000');
  assert.equal(f.montantFcfa, 43000);
});

test('Journal intact après tout un parcours', () => {
  const s = systemeAvecClient();
  s.A('caisses.fondsRoulement', { devise: 'FCFA', type: 'APPORT', montant: '1000000', commentaire: 'Départ' });
  const r = creer(s, 'A', '100').donnees;
  s.A('transactions.confirmerPaiement', { id: r.id, referencePaiement: 'Z1' });
  s.A('transactions.valider', { id: r.id });
  assert.equal(s.A('audit.verifierIntegrite', {}).donnees.integre, true);
  assert.deepEqual(s.ctx.__erreurs, []);
});
