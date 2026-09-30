/**
 * MBC Transfert — Caisses (CAD au Canada, FCFA à Larlé)
 * ------------------------------------------------------
 * Le solde d'une caisse n'est jamais « tapé » : c'est la somme de ses mouvements
 * (encaissements, paiements, apports, retraits…). Un mouvement n'est jamais
 * modifié ni supprimé ; une erreur se corrige par un mouvement inverse.
 *
 * Montants : CAD en centimes, FCFA en unités. Entrée = positif, sortie = négatif.
 *   Solde réel      = somme des mouvements
 *   Montants promis = transactions validées mais pas encore payées
 *   Solde disponible = solde réel − promis  (c'est lui qui autorise une validation)
 */

const CAISSE_CAD_ = 'CAISSE-CAD';
const CAISSE_FCFA_ = 'CAISSE-FCFA';

const TYPES_MOUVEMENT_ = {
  ENCAISSEMENT_CLIENT: 'Encaissement client',
  PAIEMENT_BENEFICIAIRE: 'Paiement au bénéficiaire',
  REMBOURSEMENT_CLIENT: 'Remboursement client',
  APPORT: 'Apport de fonds de roulement',
  RETRAIT: 'Retrait de fonds de roulement'
};

/** Ajoute un mouvement (à appeler sous verrou). */
function ajouterMouvement_(u, caisseId, type, montant, infos) {
  if (!TYPES_MOUVEMENT_[type]) throw new Error('Type de mouvement inconnu : ' + type);
  if (!Number.isSafeInteger(montant) || montant === 0) throw new Error('Montant de mouvement invalide : ' + montant);
  infos = infos || {};
  const maintenant = maintenantUTC_();
  const fuseau = caisseId === CAISSE_FCFA_ ? MBT.FUSEAUX.OUAGA : MBT.FUSEAUX.MONTREAL;
  const m = ajouterLigne_('MouvementsCaisse', {
    Id: genererId_('MVT'), CaisseId: caisseId, DateUTC: maintenant, JourneeLocale: journeeLocale_(maintenant, fuseau),
    Type: type, Montant: String(montant), TransactionId: infos.transactionId || '',
    Reference: String(infos.reference || '').slice(0, 120), Commentaire: String(infos.commentaire || '').slice(0, 500),
    CreePar: u ? u.Id : 'SYSTEME'
  });
  journaliser_(u, 'MOUVEMENT_CAISSE', { table: 'MouvementsCaisse', id: m.Id, apres: m });
  return m;
}

/** Solde réel d'une caisse (somme des mouvements). */
function soldeReel_(caisseId) {
  return lireTable_('MouvementsCaisse').reduce(function (total, m) {
    return m.CaisseId === caisseId ? total + (parseInt(m.Montant, 10) || 0) : total;
  }, 0);
}

/** Montants promis : transactions validées dont le paiement au bénéficiaire n'est pas fait. */
function montantsPromis_() {
  const S = MBT.STATUTS_TRANSACTION;
  const p = { cad: 0, fcfa: 0 };
  lireTable_('Transactions').forEach(function (t) {
    if (t.Statut !== S.VALIDEE && t.Statut !== S.REMISE_AUTORISEE) return;
    if (t.Flux === 'A') p.fcfa += parseInt(t.MontantFcfa, 10) || 0;
    if (t.Flux === 'B') p.cad += parseInt(t.MontantCadCentimes, 10) || 0;
  });
  return p;
}

/** État complet des deux caisses. */
function etatCaisses_() {
  const promis = montantsPromis_();
  const cad = soldeReel_(CAISSE_CAD_);
  const fcfa = soldeReel_(CAISSE_FCFA_);
  return {
    cad: { reelCentimes: cad, promisCentimes: promis.cad, disponibleCentimes: cad - promis.cad,
      minCentimes: lireParametreCentimes_('CAISSE_CAD_MIN'), maxCentimes: lireParametreCentimes_('CAISSE_CAD_MAX') },
    fcfa: { reel: fcfa, promis: promis.fcfa, disponible: fcfa - promis.fcfa,
      min: lireParametreFcfa_('CAISSE_FCFA_MIN'), max: lireParametreFcfa_('CAISSE_FCFA_MAX') }
  };
}

/** Apport ou retrait de fonds de roulement (séparé des transactions clients). */
function mouvementFondsRoulement_(u, d) {
  const devise = d.devise === 'FCFA' ? 'FCFA' : (d.devise === 'CAD' ? 'CAD' : null);
  if (!devise) throw new ErreurMetier('REQUETE_INVALIDE', 'Devise inconnue.');
  const type = d.type === 'RETRAIT' ? 'RETRAIT' : (d.type === 'APPORT' ? 'APPORT' : null);
  if (!type) throw new ErreurMetier('REQUETE_INVALIDE', 'Type de mouvement inconnu.');
  const montant = devise === 'CAD' ? cadVersCentimes_(d.montant) : fcfaVersEntier_(d.montant);
  if (montant <= 0) throw new ErreurMetier('MONTANT_INVALIDE', 'Le montant doit être supérieur à zéro.');
  const commentaire = texteObligatoire_(d.commentaire, 'Commentaire', 500);
  const caisse = devise === 'CAD' ? CAISSE_CAD_ : CAISSE_FCFA_;
  return avecVerrou_(function () {
    if (type === 'RETRAIT') {
      const etat = etatCaisses_();
      const dispo = devise === 'CAD' ? etat.cad.disponibleCentimes : etat.fcfa.disponible;
      if (montant > dispo) {
        throw new ErreurMetier('SOLDE_INSUFFISANT', 'Retrait impossible : il dépasse le solde disponible (fonds déjà promis à des bénéficiaires).');
      }
    }
    const m = ajouterMouvement_(u, caisse, type, type === 'RETRAIT' ? -montant : montant,
      { reference: d.reference, commentaire: commentaire });
    return { id: m.Id };
  });
}

/** Derniers mouvements d'une caisse. */
function listerMouvements_(d) {
  const caisse = d && d.devise === 'FCFA' ? CAISSE_FCFA_ : CAISSE_CAD_;
  return lireTable_('MouvementsCaisse')
    .filter(function (m) { return m.CaisseId === caisse; })
    .sort(function (a, b) { return a.DateUTC < b.DateUTC ? 1 : -1; })
    .slice(0, 100)
    .map(function (m) {
      return { id: m.Id, dateUTC: m.DateUTC, type: m.Type, libelle: TYPES_MOUVEMENT_[m.Type] || m.Type,
        montant: parseInt(m.Montant, 10) || 0, transactionId: m.TransactionId, reference: m.Reference, commentaire: m.Commentaire };
    });
}
