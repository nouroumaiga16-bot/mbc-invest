/**
 * MBC Transfert — Transactions (cœur du système)
 * -----------------------------------------------
 * Cycle de vie :
 *   En attente de paiement → Paiement confirmé → Validée → [Remise autorisée] → Payée au bénéficiaire → Clôturée
 *   + Annulée (avant paiement), Remboursée (argent rendu au client), Bloquée conformité.
 *
 * Flux A (envoi CAD → FCFA) : le client paie en CAD (Interac), le bénéficiaire reçoit des FCFA à Larlé.
 * Flux B (achat de CAD)      : le client paie en FCFA à Larlé, le bénéficiaire reçoit des CAD (Interac envoyé par l'Admin).
 *
 * Règles anti-pertes, toutes vérifiées ici, côté serveur, sous verrou :
 *  - taux verrouillé à la création (il ne change plus ensuite) ;
 *  - création bloquée sans taux récent, ou si le contrôle KYC échoue ;
 *  - rien n'est payé avant « Paiement confirmé » (référence de paiement obligatoire, unique) ;
 *  - délai de sécurité pour les nouveaux clients ;
 *  - validation impossible si la caisse qui paie n'a pas les fonds (promesses comprises) ;
 *  - confirmation renforcée (mot de passe + liste de contrôle) au-dessus du seuil ;
 *  - flux A : remise autorisée seulement avec le bon code de retrait et la pièce du bénéficiaire,
 *    et « Payée » seulement avec la photo de remise ;
 *  - aucune suppression : annulation / remboursement tracés, historique de chaque statut.
 */

/** Transitions autorisées : statut actuel → statuts possibles. */
function transitionsAutorisees_() {
  const S = MBT.STATUTS_TRANSACTION;
  const t = {};
  t[S.EN_ATTENTE_PAIEMENT] = [S.PAIEMENT_CONFIRME, S.ANNULEE];
  t[S.PAIEMENT_CONFIRME] = [S.VALIDEE, S.REMBOURSEE];
  t[S.VALIDEE] = [S.REMISE_AUTORISEE, S.PAYEE, S.REMBOURSEE, S.BLOQUEE_CONFORMITE];
  t[S.REMISE_AUTORISEE] = [S.PAYEE, S.VALIDEE, S.BLOQUEE_CONFORMITE];
  t[S.BLOQUEE_CONFORMITE] = [S.VALIDEE, S.REMBOURSEE];
  t[S.PAYEE] = [S.CLOTUREE];
  return t;
}

/** Change le statut en vérifiant que la transition est permise, et l'historise. */
function changerStatut_(u, t, nouveau, changements, commentaire) {
  const permis = transitionsAutorisees_()[t.Statut] || [];
  if (permis.indexOf(nouveau) === -1) {
    throw new ErreurMetier('STATUT_INVALIDE', 'Action impossible : la transaction est « ' + t.Statut + ' ».');
  }
  const ch = Object.assign({}, changements || {}, { Statut: nouveau, ModifieLe: maintenantUTC_(), ModifiePar: u.Id });
  const res = modifierLigne_('Transactions', t.Id, ch);
  ajouterLigne_('HistoriqueStatuts', {
    Id: genererId_('HST'), TransactionId: t.Id, AncienStatut: t.Statut, NouveauStatut: nouveau,
    DateUTC: ch.ModifieLe, UtilisateurId: u.Id, Commentaire: String(commentaire || '').slice(0, 500)
  });
  journaliserModification_(u, 'TRANSACTION_STATUT', 'Transactions', t.Id, res.avant, res.apres,
    { de: t.Statut, vers: nouveau, commentaire: commentaire || '' });
  return res.apres;
}

/** Relit une transaction (sous verrou) ou lance une erreur. */
function transactionOuErreur_(id) {
  const t = trouverParId_('Transactions', id);
  if (!t) throw new ErreurMetier('INTROUVABLE', 'Transaction introuvable.');
  return t;
}

/* ------------------------------------------------------------------
 * Calcul des montants (entiers uniquement)
 * ------------------------------------------------------------------ */

/** Frais fixes (centimes CAD) selon les tranches du paramètre FRAIS_TRANCHES. */
function fraisPourMontant_(montantCadCentimes) {
  const tranches = lireParametreJson_('FRAIS_TRANCHES');
  for (let i = 0; i < tranches.length; i++) {
    const tr = tranches[i];
    if (tr.jusquaCad === null || montantCadCentimes <= Math.round(tr.jusquaCad * 100)) return cadVersCentimes_(tr.fraisCad);
  }
  return 0;
}

/**
 * Calcule tous les montants d'une transaction à partir d'une ligne de taux.
 * montantCadCentimes = montant « principal » en CAD :
 *   flux A : ce que le client envoie (hors frais) ;
 *   flux B : ce que le bénéficiaire reçoit au Canada.
 * Le revenu brut = valeur de ce que le client paie − valeur de ce qu'on remet, au taux de référence.
 */
function calculerMontants_(flux, montantCadCentimes, taux) {
  const ref = tauxVersEntier_(taux.TauxReference);
  const D = 100 * ECHELLE_TAUX_; // centimes × dix-millièmes
  const frais = fraisPourMontant_(montantCadCentimes);
  const r = { flux: flux, montantCadCentimes: montantCadCentimes, fraisCadCentimes: frais, tauxId: taux.Id,
    tauxReference: taux.TauxReference };
  if (flux === 'A') {
    const tA = tauxVersEntier_(taux.TauxFluxA);
    r.tauxApplique = taux.TauxFluxA;
    r.montantFcfa = Math.floor(montantCadCentimes * tA / D);          // arrondi en faveur de la caisse
    r.fraisFcfa = 0;
    r.totalClientCadCentimes = montantCadCentimes + frais;
    r.totalClientFcfa = 0;
    r.revenuBrutCadCentimes = r.totalClientCadCentimes - Math.ceil(r.montantFcfa * D / ref);
  } else if (flux === 'B') {
    const tB = tauxVersEntier_(taux.TauxFluxB);
    r.tauxApplique = taux.TauxFluxB;
    r.montantFcfa = Math.ceil(montantCadCentimes * tB / D);
    r.fraisFcfa = Math.ceil(frais * tB / D);
    r.totalClientCadCentimes = 0;
    r.totalClientFcfa = r.montantFcfa + r.fraisFcfa;
    r.revenuBrutCadCentimes = Math.floor(r.totalClientFcfa * D / ref) - montantCadCentimes;
  } else {
    throw new ErreurMetier('FLUX_INVALIDE', 'Flux inconnu (A ou B).');
  }
  return r;
}

/**
 * Revenu brut d'une transaction enregistrée (centimes CAD), au taux de référence verrouillé :
 * valeur de ce que le client a payé − valeur de ce qui est remis au bénéficiaire.
 */
function revenuBrut_(t) {
  const ref = tauxVersEntier_(t.TauxReference);
  const D = 100 * ECHELLE_TAUX_;
  if (t.Flux === 'A') return parseInt(t.TotalClientCadCentimes, 10) - Math.ceil(parseInt(t.MontantFcfa, 10) * D / ref);
  return Math.floor(parseInt(t.TotalClientFcfa, 10) * D / ref) - parseInt(t.MontantCadCentimes, 10);
}

/** Montant principal saisi → centimes, avec bornes raisonnables. */
function montantPrincipal_(valeur) {
  const c = cadVersCentimes_(valeur);
  if (c < 1000) throw new ErreurMetier('MONTANT_INVALIDE', 'Montant minimum : 10,00 CAD.');
  if (c > 100000000) throw new ErreurMetier('MONTANT_INVALIDE', 'Montant trop élevé.');
  return c;
}

/** Simulation (aucun enregistrement). */
function simulerTransaction_(d) {
  const flux = d.flux === 'B' ? 'B' : (d.flux === 'A' ? 'A' : null);
  if (!flux) throw new ErreurMetier('FLUX_INVALIDE', 'Choisissez le flux A ou B.');
  const r = calculerMontants_(flux, montantPrincipal_(d.montantCad), tauxEnVigueur_());
  r.seuilProvenanceCentimes = lireParametreCentimes_('KYC_SEUIL_PROVENANCE_CAD');
  r.seuilConfirmationRenforceeCentimes = lireParametreCentimes_('DOUBLE_VALIDATION_SEUIL_CAD');
  return r;
}

/* ------------------------------------------------------------------
 * Création
 * ------------------------------------------------------------------ */

function prochainNumeroTransaction_() {
  const annee = maintenantUTC_().slice(0, 4);
  const prefixe = 'MBT-' + annee + '-';
  let max = 0;
  lireTable_('Transactions').forEach(function (t) {
    if (t.Numero && t.Numero.indexOf(prefixe) === 0) max = Math.max(max, parseInt(t.Numero.slice(prefixe.length), 10) || 0);
  });
  return prefixe + String(max + 1).padStart(6, '0');
}

/** Code de retrait à 6 chiffres (aléatoire cryptographique). */
function genererCodeRetrait_() {
  const hex = Utilities.getUuid().replace(/-/g, '');
  return String(parseInt(hex.slice(0, 12), 16) % 1000000).padStart(6, '0');
}

function empreinteCode_(transactionId, code) {
  return sha256Hex_(transactionId + ':' + String(code).trim());
}

function creerTransaction_(u, d) {
  const flux = d.flux === 'B' ? 'B' : (d.flux === 'A' ? 'A' : null);
  if (!flux) throw new ErreurMetier('FLUX_INVALIDE', 'Choisissez le flux A ou B.');
  const montant = montantPrincipal_(d.montantCad);
  return avecVerrou_(function () {
    const taux = tauxEnVigueur_(); // bloque si aucun taux récent
    const client = trouverParId_('Clients', d.clientId);
    if (!client) throw new ErreurMetier('INTROUVABLE', 'Client introuvable.');
    const benef = trouverParId_('Beneficiaires', d.beneficiaireId);
    if (!benef || benef.ClientId !== client.Id) throw new ErreurMetier('INTROUVABLE', 'Bénéficiaire introuvable pour ce client.');
    if (!estOui_(benef.Actif)) throw new ErreurMetier('BENEFICIAIRE_INACTIF', 'Ce bénéficiaire est désactivé.');

    const kyc = controleKycTransaction_(client, montant);
    if (!kyc.autorise) {
      journaliser_(u, 'TRANSACTION_REFUSEE_KYC', { table: 'Clients', id: client.Id, details: { montantCadCentimes: montant, motifs: kyc.motifs } });
      throw new ErreurMetier('KYC_BLOQUANT', 'Transaction bloquée : ' + kyc.motifs.map(function (m) { return m.message; }).join(' '));
    }

    let provenance = String(d.provenanceFonds || '').trim();
    let motif = String(d.motifTransfert || '').trim();
    if (montant > lireParametreCentimes_('KYC_SEUIL_PROVENANCE_CAD')) {
      provenance = texteObligatoire_(provenance, 'Provenance des fonds', 300);
      motif = texteObligatoire_(motif, 'Motif du transfert', 300);
    }

    const m = calculerMontants_(flux, montant, taux);
    const id = genererId_('TRX');
    const numero = prochainNumeroTransaction_();
    const code = flux === 'A' ? genererCodeRetrait_() : '';
    const maintenant = maintenantUTC_();
    const t = ajouterLigne_('Transactions', {
      Id: id, Numero: numero, Flux: flux, Statut: MBT.STATUTS_TRANSACTION.EN_ATTENTE_PAIEMENT,
      ClientId: client.Id, BeneficiaireId: benef.Id,
      MontantCadCentimes: String(m.montantCadCentimes), MontantFcfa: String(m.montantFcfa),
      TauxId: taux.Id, TauxApplique: m.tauxApplique, TauxReference: m.tauxReference,
      FraisCadCentimes: String(m.fraisCadCentimes), FraisFcfa: String(m.fraisFcfa),
      TotalClientCadCentimes: String(m.totalClientCadCentimes), TotalClientFcfa: String(m.totalClientFcfa),
      ProvenanceFonds: provenance.slice(0, 300), MotifTransfert: motif.slice(0, 300),
      CodeRetraitHash: code ? empreinteCode_(id, code) : '', TentativesCodeEchouees: '0',
      Notes: String(d.notes || '').slice(0, 500), CreeLe: maintenant, CreePar: u.Id
    });
    ajouterLigne_('HistoriqueStatuts', { Id: genererId_('HST'), TransactionId: id, AncienStatut: '',
      NouveauStatut: t.Statut, DateUTC: maintenant, UtilisateurId: u.Id, Commentaire: 'Création' });
    journaliser_(u, 'TRANSACTION_CREEE', { table: 'Transactions', id: id, apres: t });
    return { id: id, numero: numero, codeRetrait: code, montants: m };
  });
}

/* ------------------------------------------------------------------
 * Étapes du cycle de vie
 * ------------------------------------------------------------------ */

/** Le client a-t-il moins de N transactions déjà payées ? (→ délai de sécurité) */
function estNouveauClient_(clientId) {
  const S = MBT.STATUTS_TRANSACTION;
  const nb = lireTable_('Transactions').filter(function (t) {
    return t.ClientId === clientId && (t.Statut === S.PAYEE || t.Statut === S.CLOTUREE);
  }).length;
  return nb < lireParametreEntier_('NOUVEAU_CLIENT_NB_TRANSACTIONS');
}

/**
 * Confirmation de réception du paiement du client (Admin).
 * Flux A : virement Interac vérifié dans la banque → référence Interac.
 * Flux B : FCFA encaissés à Larlé → référence du reçu.
 */
function confirmerPaiement_(u, d) {
  const reference = texteObligatoire_(d.referencePaiement,
    'Référence du paiement', 120).toUpperCase();
  return avecVerrou_(function () {
    const t = transactionOuErreur_(d.id);
    // Une même référence de paiement ne peut servir qu'une fois (sauf transaction annulée).
    const doublon = lireTable_('Transactions').filter(function (x) {
      return x.Id !== t.Id && x.ReferencePaiement === reference && x.Statut !== MBT.STATUTS_TRANSACTION.ANNULEE;
    })[0];
    if (doublon) throw new ErreurMetier('REFERENCE_DEJA_UTILISEE', 'Cette référence de paiement est déjà utilisée par ' + doublon.Numero + '.');

    const maintenant = maintenantUTC_();
    const delai = estNouveauClient_(t.ClientId) ? lireParametreEntier_('NOUVEAU_CLIENT_DELAI_HEURES') : 0;
    const apres = changerStatut_(u, t, MBT.STATUTS_TRANSACTION.PAIEMENT_CONFIRME, {
      ReferencePaiement: reference, ConfirmeePar: u.Id, ConfirmeeLe: maintenant,
      PayableApres: ajouterHeures_(maintenant, delai)
    }, 'Paiement reçu, référence ' + reference);
    if (t.Flux === 'A') {
      ajouterMouvement_(u, CAISSE_CAD_, 'ENCAISSEMENT_CLIENT', parseInt(t.TotalClientCadCentimes, 10),
        { transactionId: t.Id, reference: reference, commentaire: t.Numero });
    } else {
      ajouterMouvement_(u, CAISSE_FCFA_, 'ENCAISSEMENT_CLIENT', parseInt(t.TotalClientFcfa, 10),
        { transactionId: t.Id, reference: reference, commentaire: t.Numero });
    }
    return { ok: true, payableApres: apres.PayableApres, delaiHeures: delai };
  });
}

/**
 * Validation (Admin) : contrôle KYC à nouveau, fonds suffisants dans la caisse qui paie,
 * confirmation renforcée au-dessus du seuil. Le revenu brut est figé ici.
 */
function validerTransaction_(u, d) {
  return avecVerrou_(function () {
    const t = transactionOuErreur_(d.id);
    if (t.Statut !== MBT.STATUTS_TRANSACTION.PAIEMENT_CONFIRME) {
      throw new ErreurMetier('STATUT_INVALIDE', 'Seule une transaction « Paiement confirmé » peut être validée.');
    }
    const montantCad = parseInt(t.MontantCadCentimes, 10);

    const kyc = controleKycTransaction_(trouverParId_('Clients', t.ClientId), 0);
    if (!kyc.autorise) {
      throw new ErreurMetier('KYC_BLOQUANT', 'Validation impossible : ' + kyc.motifs.map(function (m) { return m.message; }).join(' '));
    }

    // Confirmation renforcée pour les gros montants (remplace la double validation : un seul utilisateur).
    if (montantCad > lireParametreCentimes_('DOUBLE_VALIDATION_SEUIL_CAD')) {
      const c = d.controles || {};
      if (!c.paiementVu || !c.identiteVerifiee || !c.montantVerifie) {
        throw new ErreurMetier('CONFIRMATION_REQUISE', 'Gros montant : cochez les trois contrôles avant de valider.');
      }
      if (!verifierMdp_(d.motDePasse || '', u.MotDePasseHash)) {
        journaliser_(u, 'VALIDATION_MDP_INCORRECT', { table: 'Transactions', id: t.Id });
        throw new ErreurMetier('MDP_INCORRECT', 'Mot de passe incorrect.');
      }
    }

    // Fonds suffisants dans la caisse qui paiera (en tenant compte des promesses déjà faites).
    const etat = etatCaisses_();
    if (t.Flux === 'A' && parseInt(t.MontantFcfa, 10) > etat.fcfa.disponible) {
      throw new ErreurMetier('SOLDE_INSUFFISANT', 'Caisse FCFA insuffisante : disponible ' + etat.fcfa.disponible +
        ' FCFA, il faut ' + t.MontantFcfa + ' FCFA. Faites un apport ou un rééquilibrage.');
    }
    if (t.Flux === 'B' && montantCad > etat.cad.disponibleCentimes) {
      throw new ErreurMetier('SOLDE_INSUFFISANT', 'Caisse CAD insuffisante : disponible ' + centimesVersTexte_(etat.cad.disponibleCentimes) +
        ' CAD, il faut ' + centimesVersTexte_(montantCad) + ' CAD.');
    }

    // Revenu brut figé au moment de la validation, à partir des montants enregistrés à la création.
    changerStatut_(u, t, MBT.STATUTS_TRANSACTION.VALIDEE, {
      Validation1Par: u.Id, Validation1Le: maintenantUTC_(), RevenuBrutCadCentimes: String(revenuBrut_(t))
    }, montantCad > lireParametreCentimes_('DOUBLE_VALIDATION_SEUIL_CAD') ? 'Validation renforcée' : 'Validation');
    return { ok: true };
  });
}

/** Montant FCFA lisible pour les messages : 512 500 FCFA. */
function fcfaLisible_(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' FCFA';
}

/**
 * Flux A — la boutique t'a transmis le code et la pièce du bénéficiaire.
 * Si tout est bon : statut « Remise autorisée » et message WhatsApp pour la boutique.
 * 5 codes faux → la transaction est bloquée (suspicion de fraude).
 */
function autoriserRemise_(u, d) {
  const piece = texteObligatoire_(d.pieceBeneficiaireNumero, 'Numéro de pièce du bénéficiaire', 50).toUpperCase();
  return avecVerrou_(function () {
    const S = MBT.STATUTS_TRANSACTION;
    const t = transactionOuErreur_(d.id);
    if (t.Flux !== 'A') throw new ErreurMetier('STATUT_INVALIDE', 'La remise au guichet ne concerne que le flux A.');
    if (t.Statut !== S.VALIDEE) throw new ErreurMetier('STATUT_INVALIDE', 'La transaction doit être « Validée » (elle est « ' + t.Statut + ' »).');
    if (t.PayableApres && maintenantUTC_() < t.PayableApres) {
      throw new ErreurMetier('DELAI_SECURITE', 'Nouveau client : délai de sécurité en cours, remise possible à partir du ' +
        Utilities.formatDate(new Date(t.PayableApres), MBT.FUSEAUX.MONTREAL, 'dd/MM/yyyy HH:mm') + ' (heure de Montréal).');
    }
    if (!/^\d{6}$/.test(String(d.codeRetrait || '').trim()) || empreinteCode_(t.Id, d.codeRetrait) !== t.CodeRetraitHash) {
      const echecs = (parseInt(t.TentativesCodeEchouees, 10) || 0) + 1;
      modifierLigne_('Transactions', t.Id, { TentativesCodeEchouees: String(echecs) });
      journaliser_(u, 'CODE_RETRAIT_FAUX', { table: 'Transactions', id: t.Id, details: { tentatives: echecs } });
      if (echecs >= 5) {
        changerStatut_(u, Object.assign({}, t, { TentativesCodeEchouees: String(echecs) }), S.BLOQUEE_CONFORMITE, {},
          '5 codes de retrait faux');
        throw new ErreurMetier('CODE_FAUX', 'Code faux pour la 5e fois : transaction bloquée. Contactez le client.');
      }
      throw new ErreurMetier('CODE_FAUX', 'Code de retrait incorrect (' + echecs + '/5). Ne remettez rien.');
    }
    if (soldeReel_(CAISSE_FCFA_) < parseInt(t.MontantFcfa, 10)) {
      throw new ErreurMetier('SOLDE_INSUFFISANT', 'La caisse FCFA ne contient pas assez d\'argent pour cette remise.');
    }
    changerStatut_(u, t, S.REMISE_AUTORISEE, {
      PieceBeneficiaireNumero: piece, RemiseAutoriseePar: u.Id, RemiseAutoriseeLe: maintenantUTC_()
    }, 'Code vérifié, pièce ' + piece);

    const benef = trouverParId_('Beneficiaires', t.BeneficiaireId) || {};
    const message = '✅ REMISE AUTORISÉE — ' + t.Numero + '\n' +
      'Montant à remettre : ' + fcfaLisible_(parseInt(t.MontantFcfa, 10)) + '\n' +
      'Bénéficiaire : ' + (benef.NomComplet || '') + '\n' +
      'Pièce n° : ' + piece + '\n' +
      'Après la remise, envoyez-moi la photo du bénéficiaire avec l\'argent.';
    const tel = lireParametre_('BOUTIQUE_TELEPHONE').replace(/[^\d]/g, '');
    return { ok: true, message: message, lienWhatsApp: 'https://wa.me/' + tel + '?text=' + encodeURIComponent(message) };
  });
}

/** Retire une autorisation de remise (bénéficiaire pas venu, erreur…). */
function retirerAutorisation_(u, d) {
  const motif = texteObligatoire_(d.motif, 'Motif', 300);
  return avecVerrou_(function () {
    const t = transactionOuErreur_(d.id);
    if (t.Statut !== MBT.STATUTS_TRANSACTION.REMISE_AUTORISEE) throw new ErreurMetier('STATUT_INVALIDE', 'Aucune autorisation en cours.');
    changerStatut_(u, t, MBT.STATUTS_TRANSACTION.VALIDEE, { PieceBeneficiaireNumero: '' }, 'Autorisation retirée : ' + motif);
    return { ok: true };
  });
}

/**
 * Paiement effectué au bénéficiaire.
 * Flux A : photo de remise obligatoire (après « Remise autorisée »).
 * Flux B : référence du virement Interac envoyé obligatoire (après « Validée »).
 */
function marquerPayee_(u, d) {
  return avecVerrou_(function () {
    const S = MBT.STATUTS_TRANSACTION;
    const t = transactionOuErreur_(d.id);
    const ch = { PayeePar: u.Id, PayeeLe: maintenantUTC_() };
    if (t.Flux === 'A') {
      if (t.Statut !== S.REMISE_AUTORISEE) throw new ErreurMetier('STATUT_INVALIDE', 'Autorisez d\'abord la remise (code de retrait).');
      if (!d.photoPreuve) throw new ErreurMetier('PREUVE_MANQUANTE', 'La photo de remise est obligatoire.');
      ch.PreuveRemiseId = enregistrerPhoto_(d.photoPreuve, ['Transactions', t.Numero], t.Numero + '_remise');
      const montant = parseInt(t.MontantFcfa, 10);
      if (soldeReel_(CAISSE_FCFA_) < montant) throw new ErreurMetier('SOLDE_INSUFFISANT', 'Caisse FCFA insuffisante.');
      changerStatut_(u, t, S.PAYEE, ch, 'Remise faite, photo enregistrée');
      ajouterMouvement_(u, CAISSE_FCFA_, 'PAIEMENT_BENEFICIAIRE', -montant, { transactionId: t.Id, commentaire: t.Numero });
    } else {
      if (t.Statut !== S.VALIDEE) throw new ErreurMetier('STATUT_INVALIDE', 'La transaction doit être « Validée » (elle est « ' + t.Statut + ' »).');
      if (t.PayableApres && maintenantUTC_() < t.PayableApres) {
        throw new ErreurMetier('DELAI_SECURITE', 'Nouveau client : délai de sécurité en cours jusqu\'au ' +
          Utilities.formatDate(new Date(t.PayableApres), MBT.FUSEAUX.MONTREAL, 'dd/MM/yyyy HH:mm') + ' (heure de Montréal).');
      }
      ch.ReferenceVersement = texteObligatoire_(d.referenceVersement, 'Référence du virement Interac envoyé', 120).toUpperCase();
      if (d.photoPreuve) ch.PreuveRemiseId = enregistrerPhoto_(d.photoPreuve, ['Transactions', t.Numero], t.Numero + '_virement');
      const montant = parseInt(t.MontantCadCentimes, 10);
      if (soldeReel_(CAISSE_CAD_) < montant) throw new ErreurMetier('SOLDE_INSUFFISANT', 'Caisse CAD insuffisante.');
      changerStatut_(u, t, S.PAYEE, ch, 'Virement envoyé, référence ' + ch.ReferenceVersement);
      ajouterMouvement_(u, CAISSE_CAD_, 'PAIEMENT_BENEFICIAIRE', -montant, { transactionId: t.Id, reference: ch.ReferenceVersement, commentaire: t.Numero });
    }
    return { ok: true };
  });
}

function cloturerTransaction_(u, d) {
  return avecVerrou_(function () {
    const t = transactionOuErreur_(d.id);
    changerStatut_(u, t, MBT.STATUTS_TRANSACTION.CLOTUREE, { ClotureePar: u.Id, ClotureeLe: maintenantUTC_() }, 'Clôture');
    return { ok: true };
  });
}

/** Annulation : seulement avant réception de l'argent du client. */
function annulerTransaction_(u, d) {
  const motif = texteObligatoire_(d.motif, 'Motif de l\'annulation', 300);
  return avecVerrou_(function () {
    const t = transactionOuErreur_(d.id);
    if (t.Statut !== MBT.STATUTS_TRANSACTION.EN_ATTENTE_PAIEMENT) {
      throw new ErreurMetier('STATUT_INVALIDE', 'L\'argent du client a déjà été reçu : utilisez « Rembourser ».');
    }
    changerStatut_(u, t, MBT.STATUTS_TRANSACTION.ANNULEE, { MotifAnnulation: motif }, 'Annulation : ' + motif);
    return { ok: true };
  });
}

/** Remboursement : l'argent reçu est rendu au client (avant tout paiement au bénéficiaire). */
function rembourserTransaction_(u, d) {
  const motif = texteObligatoire_(d.motif, 'Motif du remboursement', 300);
  const reference = texteObligatoire_(d.reference, 'Référence du remboursement', 120);
  return avecVerrou_(function () {
    const t = transactionOuErreur_(d.id);
    changerStatut_(u, t, MBT.STATUTS_TRANSACTION.REMBOURSEE, { MotifAnnulation: motif }, 'Remboursement : ' + motif);
    if (t.Flux === 'A') {
      ajouterMouvement_(u, CAISSE_CAD_, 'REMBOURSEMENT_CLIENT', -parseInt(t.TotalClientCadCentimes, 10), { transactionId: t.Id, reference: reference, commentaire: t.Numero });
    } else {
      ajouterMouvement_(u, CAISSE_FCFA_, 'REMBOURSEMENT_CLIENT', -parseInt(t.TotalClientFcfa, 10), { transactionId: t.Id, reference: reference, commentaire: t.Numero });
    }
    return { ok: true };
  });
}

/** Débloque une transaction « Bloquée conformité » (retour à « Validée », compteur de codes remis à zéro). */
function debloquerTransaction_(u, d) {
  const motif = texteObligatoire_(d.motif, 'Motif du déblocage', 300);
  return avecVerrou_(function () {
    const t = transactionOuErreur_(d.id);
    if (t.Statut !== MBT.STATUTS_TRANSACTION.BLOQUEE_CONFORMITE) throw new ErreurMetier('STATUT_INVALIDE', 'Transaction non bloquée.');
    changerStatut_(u, t, MBT.STATUTS_TRANSACTION.VALIDEE, { TentativesCodeEchouees: '0' }, 'Déblocage : ' + motif);
    return { ok: true };
  });
}

/* ------------------------------------------------------------------
 * Lecture
 * ------------------------------------------------------------------ */

function resumeTransaction_(t, clients, benefs) {
  return {
    id: t.Id, numero: t.Numero, flux: t.Flux, statut: t.Statut,
    client: (clients[t.ClientId] || {}).NomComplet || '', beneficiaire: (benefs[t.BeneficiaireId] || {}).NomComplet || '',
    montantCadCentimes: parseInt(t.MontantCadCentimes, 10) || 0, montantFcfa: parseInt(t.MontantFcfa, 10) || 0,
    creeLe: t.CreeLe, payableApres: t.PayableApres
  };
}

function indexer_(table) {
  const idx = {};
  lireTable_(table).forEach(function (x) { idx[x.Id] = x; });
  return idx;
}

function listerTransactions_(f) {
  f = f || {};
  const clients = indexer_('Clients');
  const benefs = indexer_('Beneficiaires');
  const q = String(f.recherche || '').trim().toLowerCase();
  const S = MBT.STATUTS_TRANSACTION;
  const enCours = [S.EN_ATTENTE_PAIEMENT, S.PAIEMENT_CONFIRME, S.VALIDEE, S.REMISE_AUTORISEE, S.PAYEE, S.BLOQUEE_CONFORMITE];
  return lireTable_('Transactions')
    .filter(function (t) {
      if (f.statut === 'EN_COURS' && enCours.indexOf(t.Statut) === -1) return false;
      if (f.statut && f.statut !== 'EN_COURS' && t.Statut !== f.statut) return false;
      if (f.flux && t.Flux !== f.flux) return false;
      if (q) {
        const texte = [t.Numero, (clients[t.ClientId] || {}).NomComplet, (benefs[t.BeneficiaireId] || {}).NomComplet, t.ReferencePaiement].join(' ').toLowerCase();
        if (texte.indexOf(q) === -1) return false;
      }
      return true;
    })
    .sort(function (a, b) { return a.CreeLe < b.CreeLe ? 1 : -1; })
    .slice(0, 200)
    .map(function (t) { return resumeTransaction_(t, clients, benefs); });
}

/** Actions possibles selon le statut (pour afficher les bons boutons). */
function actionsPossibles_(t) {
  const S = MBT.STATUTS_TRANSACTION;
  const a = [];
  if (t.Statut === S.EN_ATTENTE_PAIEMENT) a.push('confirmerPaiement', 'annuler');
  if (t.Statut === S.PAIEMENT_CONFIRME) a.push('valider', 'rembourser');
  if (t.Statut === S.VALIDEE) a.push(t.Flux === 'A' ? 'autoriserRemise' : 'marquerPayee', 'rembourser');
  if (t.Statut === S.REMISE_AUTORISEE) a.push('marquerPayee', 'retirerAutorisation');
  if (t.Statut === S.BLOQUEE_CONFORMITE) a.push('debloquer', 'rembourser');
  if (t.Statut === S.PAYEE) a.push('cloturer');
  return a;
}

function ficheTransaction_(u, d) {
  const t = transactionOuErreur_(d.id);
  const client = trouverParId_('Clients', t.ClientId) || {};
  const benef = trouverParId_('Beneficiaires', t.BeneficiaireId) || {};
  const n = function (v) { return parseInt(v, 10) || 0; };
  const fiche = {
    id: t.Id, numero: t.Numero, flux: t.Flux, statut: t.Statut,
    client: { id: client.Id, nomComplet: client.NomComplet, numeroClient: client.NumeroClient, telephone: client.Telephone, statut: client.Statut },
    beneficiaire: { id: benef.Id, nomComplet: benef.NomComplet, telephone: benef.Telephone, ville: benef.Ville, pays: benef.Pays, lienClient: benef.LienClient },
    montantCadCentimes: n(t.MontantCadCentimes), montantFcfa: n(t.MontantFcfa),
    fraisCadCentimes: n(t.FraisCadCentimes), fraisFcfa: n(t.FraisFcfa),
    totalClientCadCentimes: n(t.TotalClientCadCentimes), totalClientFcfa: n(t.TotalClientFcfa),
    tauxApplique: t.TauxApplique, provenanceFonds: t.ProvenanceFonds, motifTransfert: t.MotifTransfert,
    referencePaiement: t.ReferencePaiement, referenceVersement: t.ReferenceVersement,
    payableApres: t.PayableApres, pieceBeneficiaireNumero: t.PieceBeneficiaireNumero,
    aPreuve: !!t.PreuveRemiseId, tentativesCodeEchouees: n(t.TentativesCodeEchouees),
    motifAnnulation: t.MotifAnnulation, notes: t.Notes, creeLe: t.CreeLe,
    depasseSeuilRenforce: n(t.MontantCadCentimes) > lireParametreCentimes_('DOUBLE_VALIDATION_SEUIL_CAD'),
    actions: actionsPossibles_(t),
    historique: lireTable_('HistoriqueStatuts').filter(function (h) { return h.TransactionId === t.Id; })
      .sort(function (a, b) { return a.DateUTC < b.DateUTC ? -1 : 1; })
      .map(function (h) { return { de: h.AncienStatut, vers: h.NouveauStatut, dateUTC: h.DateUTC, commentaire: h.Commentaire }; })
  };
  // Informations internes (marge, taux de référence) : Admin uniquement.
  if (u.Role === MBT.ROLES.ADMIN) {
    fiche.tauxReference = t.TauxReference;
    fiche.revenuBrutCadCentimes = t.RevenuBrutCadCentimes === '' ? null : n(t.RevenuBrutCadCentimes);
  }
  return fiche;
}

/** Photo de preuve de remise (Admin). */
function preuveTransaction_(u, d) {
  const t = transactionOuErreur_(d.id);
  const p = lirePhoto_(t.PreuveRemiseId);
  journaliser_(u, 'PREUVE_CONSULTEE', { table: 'Transactions', id: t.Id });
  return p;
}
