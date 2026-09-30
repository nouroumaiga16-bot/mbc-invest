/**
 * MBC Transfert — Taux de change automatique
 * -------------------------------------------
 * Le FCFA (XOF) est fixé à l'euro : 1 € = 655,957 FCFA, toujours.
 * Le taux CAD → FCFA se déduit donc du seul cours officiel EUR → CAD :
 *     FCFA pour 1 CAD = 655,957 ÷ (CAD pour 1 €)
 *
 * Toutes les 6 heures (tâche automatique), l'outil :
 *  1. lit le cours EUR/CAD officiel de la Banque centrale européenne
 *     (source de secours : Frankfurter, qui republie les mêmes cours BCE) ;
 *  2. calcule le taux de référence, ajoute l'écart choisi (paramètre TAUX_AUTO_ECART_FCFA) ;
 *  3. enregistre le taux si c'est nécessaire (nouveau cours, ou dernier taux de plus de 20 h).
 *
 * Garde-fous :
 *  - une saisie manuelle de l'Admin reste prioritaire pendant 24 h ;
 *  - un écart anormal avec le taux précédent n'est PAS enregistré (erreur de source possible) :
 *    l'événement est inscrit au journal et l'Admin saisit le taux à la main s'il le confirme ;
 *  - si Internet ou la source sont indisponibles, rien n'est enregistré : l'ancien taux
 *    reste valable jusqu'à 24 h, puis les créations de transactions sont bloquées (sécurité).
 */

const FCFA_PAR_EURO_ENTIER_ = 6559570; // 655,957 FCFA pour 1 €, en dix-millièmes

/** Sources du cours EUR → CAD, essayées dans l'ordre. */
function sourcesCoursEurCad_() {
  return [
    {
      nom: 'BCE',
      url: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
      lire: function (texte) {
        const cours = /currency=['"]CAD['"]\s+rate=['"]([\d.]+)['"]/.exec(texte);
        const date = /time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(texte);
        return cours ? { cours: cours[1], date: date ? date[1] : '' } : null;
      }
    },
    {
      nom: 'Frankfurter (BCE)',
      url: 'https://api.frankfurter.app/latest?from=EUR&to=CAD',
      lire: function (texte) {
        const j = JSON.parse(texte);
        return j && j.rates && j.rates.CAD ? { cours: String(j.rates.CAD), date: j.date || '' } : null;
      }
    }
  ];
}

/** Lit le cours EUR → CAD (en dix-millièmes, ex. 1,4723 → 14723). */
function lireCoursEurCad_() {
  const erreurs = [];
  const sources = sourcesCoursEurCad_();
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    try {
      const r = UrlFetchApp.fetch(s.url, { muteHttpExceptions: true, followRedirects: true });
      if (r.getResponseCode() !== 200) throw new Error('réponse ' + r.getResponseCode());
      const res = s.lire(r.getContentText());
      if (!res) throw new Error('cours CAD absent');
      const cours = Math.round(parseFloat(res.cours) * ECHELLE_TAUX_);
      // Contrôle de vraisemblance : 1 € vaut entre 0,50 et 5,00 CAD.
      if (!(cours >= 5000 && cours <= 50000)) throw new Error('cours invraisemblable : ' + res.cours);
      return { source: s.nom, cours: cours, date: res.date };
    } catch (e) {
      erreurs.push(s.nom + ' : ' + e.message);
    }
  }
  throw new Error('Cours EUR/CAD indisponible (' + erreurs.join(' ; ') + ')');
}

/** Taux de référence (FCFA pour 1 CAD, dix-millièmes) à partir du cours EUR → CAD. */
function referenceDepuisEurCad_(coursEurCad) {
  return Math.round(FCFA_PAR_EURO_ENTIER_ * ECHELLE_TAUX_ / coursEurCad);
}

/** Écart choisi par l'Admin (peut être négatif), en dix-millièmes. */
function ecartAutoEntier_() {
  const v = String(lireParametre_('TAUX_AUTO_ECART_FCFA')).trim().replace(',', '.').replace(/^\+/, '');
  const negatif = v.charAt(0) === '-';
  const n = tauxVersEntier_(negatif ? v.slice(1) : v, 'Écart du taux automatique');
  return negatif ? -n : n;
}

/**
 * Mise à jour automatique du taux (appelée toutes les 6 h par la tâche planifiée,
 * ou à la main). forcer === true : ignore la priorité de la saisie manuelle.
 * Renvoie { statut, ... } : ENREGISTRE, INCHANGE, MANUEL_PRIORITAIRE, ECART_SUSPECT, ECHEC, DESACTIVE.
 */
function majTauxAutomatique(forcer) {
  forcer = forcer === true; // la tâche planifiée passe un objet « événement » : on l'ignore
  PARAMETRES_CACHE_ = null;
  if (!lireParametreBooleen_('TAUX_AUTO_ACTIF')) return { statut: 'DESACTIVE' };

  return avecVerrou_(function () {
    const dernier = dernierTaux_();
    const maintenant = Date.now();
    const ageDernier = dernier ? maintenant - Date.parse(dernier.DateUTC) : Infinity;

    // Un taux saisi à la main il y a moins de 24 h reste prioritaire.
    if (!forcer && dernier && dernier.Source !== 'AUTO' && ageDernier < 24 * 3600000) {
      return { statut: 'MANUEL_PRIORITAIRE' };
    }

    let cours;
    try {
      cours = lireCoursEurCad_();
    } catch (e) {
      journaliser_(null, 'TAUX_AUTO_ECHEC', { details: { erreur: e.message } });
      return { statut: 'ECHEC', message: e.message };
    }

    const reference = referenceDepuisEurCad_(cours.cours) + ecartAutoEntier_();
    const commentaire = 'Automatique — ' + cours.source + (cours.date ? ' du ' + cours.date : '') +
      ' : 1 EUR = ' + entierVersTaux_(cours.cours).replace(/0+$/, '').replace(/\.$/, '') + ' CAD';

    if (dernier) {
      const ancien = tauxVersEntier_(dernier.TauxReference);
      const ecartPct = Math.abs(reference - ancien) * 100 / ancien;
      if (ecartPct > lireParametreDecimal_('TAUX_ECART_ALERTE_POURCENT')) {
        journaliser_(null, 'TAUX_AUTO_REFUSE', { details: {
          motif: 'Écart anormal avec le taux précédent', ecartPourcent: ecartPct.toFixed(2),
          ancien: dernier.TauxReference, propose: entierVersTaux_(reference), source: commentaire } });
        return { statut: 'ECART_SUSPECT', message: 'Écart de ' + ecartPct.toFixed(1) + ' % avec le taux précédent : non enregistré.' };
      }
      // Même valeur et taux automatique encore récent : inutile d'ajouter une ligne.
      if (!forcer && reference === ancien && dernier.Source === 'AUTO' && ageDernier < 20 * 3600000) {
        return { statut: 'INCHANGE' };
      }
    }

    const c = calculerTaux_(reference);
    const ligne = ajouterLigne_('Taux', {
      Id: genererId_('TAUX'), DateUTC: maintenantUTC_(),
      TauxReference: entierVersTaux_(c.reference),
      MargeAType: c.typeA, MargeAValeur: lireParametre_('MARGE_A_VALEUR'),
      MargeBType: c.typeB, MargeBValeur: lireParametre_('MARGE_B_VALEUR'),
      TauxFluxA: entierVersTaux_(c.tauxA), TauxFluxB: entierVersTaux_(c.tauxB),
      SaisiPar: 'AUTOMATIQUE', Commentaire: commentaire, Source: 'AUTO'
    });
    journaliser_(null, 'TAUX_AUTO', { table: 'Taux', id: ligne.Id, apres: ligne });
    return { statut: 'ENREGISTRE', tauxReference: ligne.TauxReference, commentaire: commentaire };
  });
}
