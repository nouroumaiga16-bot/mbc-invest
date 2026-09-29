/**
 * MBC Transfert — Taux de change
 * -------------------------------
 * Chaque jour, l'Admin saisit le taux de référence du marché (FCFA pour 1 CAD).
 * L'outil calcule :
 *   taux flux A (envoi CAD → FCFA)   = référence − marge A  (ce que reçoit le bénéficiaire par CAD)
 *   taux flux B (achat de CAD)        = référence + marge B  (prix en FCFA d'un CAD)
 *
 * Les taux sont manipulés en ENTIERS « dix-millièmes » : 435,5 FCFA → 4 355 000.
 * Aucun calcul à virgule : pas d'erreur d'arrondi possible.
 */

const ECHELLE_TAUX_ = 10000; // 4 décimales

/** « 435,5 » → 4355000 (entier). Refuse plus de 4 décimales. */
function tauxVersEntier_(valeur, libelle) {
  const s = String(valeur === undefined || valeur === null ? '' : valeur).trim().replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,4})?$/.test(s)) {
    throw new ErreurMetier('TAUX_INVALIDE', '« ' + (libelle || 'Taux') + ' » invalide (nombre positif, 4 décimales maximum).');
  }
  const p = s.split('.');
  const n = parseInt(p[0], 10) * ECHELLE_TAUX_ + (p[1] ? parseInt((p[1] + '0000').slice(0, 4), 10) : 0);
  if (!Number.isSafeInteger(n)) throw new ErreurMetier('TAUX_INVALIDE', 'Taux trop grand.');
  return n;
}

/** 4355000 → « 435.5000 » (format de stockage). */
function entierVersTaux_(n) {
  return Math.floor(n / ECHELLE_TAUX_) + '.' + String(n % ECHELLE_TAUX_).padStart(4, '0');
}

/** Marge en dix-millièmes de FCFA par CAD, selon son type (FCFA par CAD ou %). */
function margeEnEntier_(type, valeur, referenceEntier) {
  const v = tauxVersEntier_(valeur, 'Marge');
  if (type === 'POURCENT') return Math.round(referenceEntier * v / (100 * ECHELLE_TAUX_));
  return v; // FCFA_PAR_CAD
}

/** Calcule les taux A et B à partir d'une référence et des marges des paramètres. */
function calculerTaux_(referenceEntier) {
  const typeA = lireParametre_('MARGE_A_TYPE');
  const typeB = lireParametre_('MARGE_B_TYPE');
  const margeA = margeEnEntier_(typeA, lireParametre_('MARGE_A_VALEUR'), referenceEntier);
  const margeB = margeEnEntier_(typeB, lireParametre_('MARGE_B_VALEUR'), referenceEntier);
  const tauxA = referenceEntier - margeA;
  const tauxB = referenceEntier + margeB;
  if (tauxA <= 0) throw new ErreurMetier('TAUX_INVALIDE', 'La marge A est plus grande que le taux de référence.');
  return { reference: referenceEntier, tauxA: tauxA, tauxB: tauxB, margeA: margeA, margeB: margeB, typeA: typeA, typeB: typeB };
}

/** Dernier taux saisi (ou null). */
function dernierTaux_() {
  const liste = lireTable_('Taux');
  if (!liste.length) return null;
  return liste.reduce(function (a, b) { return a.DateUTC >= b.DateUTC ? a : b; });
}

/**
 * Taux utilisable pour créer une transaction.
 * Lance une erreur si aucun taux n'a été saisi depuis TAUX_VALIDITE_HEURES.
 */
function tauxEnVigueur_() {
  const t = dernierTaux_();
  const heures = lireParametreEntier_('TAUX_VALIDITE_HEURES');
  if (!t) throw new ErreurMetier('TAUX_ABSENT', 'Aucun taux saisi : saisissez le taux du jour avant de créer une transaction.');
  if (Date.now() - Date.parse(t.DateUTC) > heures * 3600000) {
    throw new ErreurMetier('TAUX_PERIME', 'Le dernier taux date de plus de ' + heures + ' h : saisissez le taux du jour avant de créer une transaction.');
  }
  return t;
}

/** Aperçu des taux A et B pour une référence, avant enregistrement. */
function apercuTaux_(d) {
  const c = calculerTaux_(tauxVersEntier_(d.tauxReference, 'Taux de référence'));
  return { tauxReference: entierVersTaux_(c.reference), tauxFluxA: entierVersTaux_(c.tauxA), tauxFluxB: entierVersTaux_(c.tauxB) };
}

/** Saisie du taux du jour (Admin). */
function saisirTaux_(u, d) {
  const reference = tauxVersEntier_(d.tauxReference, 'Taux de référence');
  if (reference <= 0) throw new ErreurMetier('TAUX_INVALIDE', 'Le taux doit être positif.');
  return avecVerrou_(function () {
    // Anti-faute de frappe : un écart important avec le taux précédent doit être confirmé.
    const precedent = dernierTaux_();
    if (precedent && !d.confirmerEcart) {
      const ancien = tauxVersEntier_(precedent.TauxReference);
      const ecartPct = Math.abs(reference - ancien) * 100 / ancien;
      const seuil = lireParametreDecimal_('TAUX_ECART_ALERTE_POURCENT');
      if (ecartPct > seuil) {
        throw new ErreurMetier('TAUX_ECART', 'Ce taux s\'écarte de ' + ecartPct.toFixed(1) + ' % du précédent (' +
          precedent.TauxReference + '). Vérifiez, puis confirmez si c\'est bien le bon taux.');
      }
    }
    const c = calculerTaux_(reference);
    const ligne = ajouterLigne_('Taux', {
      Id: genererId_('TAUX'), DateUTC: maintenantUTC_(),
      TauxReference: entierVersTaux_(c.reference),
      MargeAType: c.typeA, MargeAValeur: lireParametre_('MARGE_A_VALEUR'),
      MargeBType: c.typeB, MargeBValeur: lireParametre_('MARGE_B_VALEUR'),
      TauxFluxA: entierVersTaux_(c.tauxA), TauxFluxB: entierVersTaux_(c.tauxB),
      SaisiPar: u.Id, Commentaire: String(d.commentaire || '').slice(0, 300)
    });
    journaliser_(u, 'TAUX_SAISI', { table: 'Taux', id: ligne.Id, apres: ligne });
    return { id: ligne.Id, tauxReference: ligne.TauxReference, tauxFluxA: ligne.TauxFluxA, tauxFluxB: ligne.TauxFluxB };
  });
}

/** Taux actuel + historique (du plus récent au plus ancien). */
function etatTaux_(d) {
  const heures = lireParametreEntier_('TAUX_VALIDITE_HEURES');
  const liste = lireTable_('Taux').sort(function (a, b) { return a.DateUTC < b.DateUTC ? 1 : -1; });
  const limite = Math.min(parseInt((d && d.limite) || 90, 10) || 90, 500);
  const t = liste[0] || null;
  return {
    actuel: t ? {
      dateUTC: t.DateUTC, tauxReference: t.TauxReference, tauxFluxA: t.TauxFluxA, tauxFluxB: t.TauxFluxB,
      perime: Date.now() - Date.parse(t.DateUTC) > heures * 3600000
    } : null,
    validiteHeures: heures,
    historique: liste.slice(0, limite).map(function (x) {
      return { dateUTC: x.DateUTC, tauxReference: x.TauxReference, tauxFluxA: x.TauxFluxA, tauxFluxB: x.TauxFluxB, commentaire: x.Commentaire };
    })
  };
}
