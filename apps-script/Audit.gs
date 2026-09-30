/**
 * MBC Transfert — Journal d'audit immuable
 * -----------------------------------------
 * Chaque action (connexion, création, modification, changement de paramètre…)
 * ajoute UNE ligne dans l'onglet « JournalAudit ». Le code n'offre aucun moyen
 * de modifier ou supprimer une ligne du journal.
 *
 * Protection supplémentaire : chaque ligne contient une empreinte (Hash) calculée
 * à partir de son contenu ET de l'empreinte de la ligne précédente (« chaîne »).
 * Si quelqu'un modifie ou supprime une ligne à la main dans le classeur,
 * la vérification d'intégrité le détecte immédiatement.
 */

const TAILLE_MAX_CELLULE_ = 45000;

/** Transforme une valeur en texte JSON, sans secrets, tronqué si trop long. */
function jsonAudit_(valeur) {
  if (valeur === undefined || valeur === null || valeur === '') return '';
  const propre = (typeof valeur === 'object') ? sansSecrets_(valeur) : valeur;
  let s = typeof propre === 'string' ? propre : JSON.stringify(propre);
  if (s.length > TAILLE_MAX_CELLULE_) s = s.slice(0, TAILLE_MAX_CELLULE_) + '…[tronqué]';
  return s;
}

/** Ne garde que les champs qui ont réellement changé entre avant et après. */
function differences_(avant, apres) {
  const a = {}, n = {};
  Object.keys(apres || {}).forEach(function (k) {
    if (k.charAt(0) === '_') return;
    const va = avant ? avant[k] : undefined;
    if (String(va === undefined ? '' : va) !== String(apres[k])) {
      a[k] = va === undefined ? '' : va;
      n[k] = apres[k];
    }
  });
  return { avant: a, apres: n };
}

/** Texte « canonique » d'une entrée, utilisé pour calculer son empreinte. */
function texteCanoniqueAudit_(e) {
  return [e.Id, e.DateUTC, e.UtilisateurId, e.UtilisateurNom, e.Role, e.Action, e.Table,
    e.EnregistrementId, e.AncienneValeur, e.NouvelleValeur, e.Details, e.HashPrecedent].join('|');
}

/**
 * Ajoute une entrée au journal.
 * @param {Object|null} utilisateur  l'utilisateur connecté (ou null pour « système » / anonyme)
 * @param {string} action            code de l'action, ex. 'PARAMETRE_MODIFIE'
 * @param {Object} infos             { table, id, avant, apres, details }
 */
function journaliser_(utilisateur, action, infos) {
  infos = infos || {};
  return avecVerrou_(function () {
    const f = feuille_('JournalAudit');
    const derniere = f.getLastRow();
    let hashPrecedent = 'ORIGINE';
    if (derniere >= 2) {
      const colHash = SCHEMA.JournalAudit.indexOf('Hash') + 1;
      hashPrecedent = String(f.getRange(derniere, colHash).getValue()) || 'ORIGINE';
    }
    const entree = {
      Id: genererId_('AUD'),
      DateUTC: maintenantUTC_(),
      UtilisateurId: utilisateur ? utilisateur.Id : 'SYSTEME',
      UtilisateurNom: utilisateur ? utilisateur.NomComplet : (infos.nomAnonyme || 'Système'),
      Role: utilisateur ? utilisateur.Role : '',
      Action: action,
      Table: infos.table || '',
      EnregistrementId: infos.id || '',
      AncienneValeur: jsonAudit_(infos.avant),
      NouvelleValeur: jsonAudit_(infos.apres),
      Details: jsonAudit_(infos.details),
      HashPrecedent: hashPrecedent
    };
    entree.Hash = sha256Hex_(texteCanoniqueAudit_(entree));
    ajouterLigne_('JournalAudit', entree);
    return entree.Id;
  });
}

/** Raccourci : journalise une modification en ne gardant que les champs changés. */
function journaliserModification_(utilisateur, action, table, id, avant, apres, details) {
  const diff = differences_(sansSecrets_(avant), sansSecrets_(apres));
  return journaliser_(utilisateur, action, {
    table: table, id: id, avant: diff.avant, apres: diff.apres, details: details
  });
}

/**
 * Vérifie toute la chaîne du journal.
 * Renvoie { integre: true/false, nbEntrees, ligneErreur, message }.
 */
function verifierIntegriteJournal_() {
  const lignes = lireTable_('JournalAudit');
  let precedent = 'ORIGINE';
  for (let i = 0; i < lignes.length; i++) {
    const e = lignes[i];
    if (e.HashPrecedent !== precedent) {
      return { integre: false, nbEntrees: lignes.length, ligneErreur: e._ligne,
        message: 'Chaîne rompue à la ligne ' + e._ligne + ' : une ligne a été supprimée ou déplacée juste avant.' };
    }
    if (sha256Hex_(texteCanoniqueAudit_(e)) !== e.Hash) {
      return { integre: false, nbEntrees: lignes.length, ligneErreur: e._ligne,
        message: 'La ligne ' + e._ligne + ' a été modifiée à la main.' };
    }
    precedent = e.Hash;
  }
  return { integre: true, nbEntrees: lignes.length, ligneErreur: null,
    message: 'Journal intact (' + lignes.length + ' entrées vérifiées).' };
}

/**
 * Liste paginée du journal, du plus récent au plus ancien, avec filtres simples.
 * filtres : { action, utilisateurId, du (AAAA-MM-JJ), au (AAAA-MM-JJ), recherche, page, parPage }
 */
function listerJournal_(filtres) {
  filtres = filtres || {};
  const parPage = Math.min(Math.max(parseInt(filtres.parPage, 10) || 50, 1), 200);
  const page = Math.max(parseInt(filtres.page, 10) || 1, 1);
  const recherche = String(filtres.recherche || '').toLowerCase();
  let lignes = lireTable_('JournalAudit').reverse().filter(function (e) {
    if (filtres.action && e.Action !== filtres.action) return false;
    if (filtres.utilisateurId && e.UtilisateurId !== filtres.utilisateurId) return false;
    if (filtres.du && e.DateUTC.slice(0, 10) < filtres.du) return false;
    if (filtres.au && e.DateUTC.slice(0, 10) > filtres.au) return false;
    if (recherche) {
      const texte = [e.Action, e.UtilisateurNom, e.Table, e.EnregistrementId,
        e.AncienneValeur, e.NouvelleValeur, e.Details].join(' ').toLowerCase();
      if (texte.indexOf(recherche) === -1) return false;
    }
    return true;
  });
  const total = lignes.length;
  lignes = lignes.slice((page - 1) * parPage, page * parPage).map(sansSecrets_);
  return { total: total, page: page, parPage: parPage, entrees: lignes };
}
