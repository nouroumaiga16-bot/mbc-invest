/**
 * MBC Transfert — Paramètres modifiables
 * ---------------------------------------
 * Tous les seuils, marges et délais sont lus dans l'onglet « Parametres ».
 * Seul l'Admin peut les modifier ; chaque modification est journalisée
 * avec l'ancienne et la nouvelle valeur.
 */

let PARAMETRES_CACHE_ = null; // cache le temps d'une exécution

function tousParametres_() {
  if (!PARAMETRES_CACHE_) {
    PARAMETRES_CACHE_ = {};
    lireTable_('Parametres').forEach(function (p) { PARAMETRES_CACHE_[p.Cle] = p; });
  }
  return PARAMETRES_CACHE_;
}

/** Valeur brute (texte) d'un paramètre ; erreur si absent. */
function lireParametre_(cle) {
  const p = tousParametres_()[cle];
  if (!p) throw new Error('Paramètre manquant : ' + cle + ' (relancez l\'installation).');
  return p.Valeur;
}

function lireParametreEntier_(cle) { return parseInt(lireParametre_(cle), 10); }
function lireParametreDecimal_(cle) { return parseFloat(lireParametre_(cle)); }
function lireParametreCentimes_(cle) { return cadVersCentimes_(lireParametre_(cle)); }
function lireParametreFcfa_(cle) { return fcfaVersEntier_(lireParametre_(cle)); }
function lireParametreBooleen_(cle) { return estOui_(lireParametre_(cle)); }
function lireParametreJson_(cle) { return JSON.parse(lireParametre_(cle)); }

/**
 * Vérifie et normalise une valeur selon le type du paramètre.
 * Renvoie la valeur à stocker (texte) ou lance une ErreurMetier.
 */
function normaliserValeurParametre_(type, valeur, libelle) {
  const brut = String(valeur === undefined || valeur === null ? '' : valeur).trim();
  const erreur = function (msg) {
    return new ErreurMetier('PARAMETRE_INVALIDE', '« ' + libelle + ' » : ' + msg);
  };
  if (type === 'entier') {
    if (!/^\d+$/.test(brut)) throw erreur('nombre entier positif attendu.');
    return String(parseInt(brut, 10));
  }
  if (type === 'decimal') {
    const s = brut.replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(s)) throw erreur('nombre positif attendu (ex. 2,5).');
    return s;
  }
  if (type === 'cad') return centimesVersTexte_(cadVersCentimes_(brut));
  if (type === 'fcfa') return String(fcfaVersEntier_(brut));
  if (type === 'booleen') {
    const b = brut.toUpperCase();
    if (['OUI', 'NON'].indexOf(b) === -1) throw erreur('OUI ou NON attendu.');
    return b;
  }
  if (type === 'texte') {
    if (brut.length > 500) throw erreur('texte trop long (500 caractères maximum).');
    return brut;
  }
  if (type.indexOf('choix:') === 0) {
    const choix = type.slice(6).split('|');
    if (choix.indexOf(brut) === -1) throw erreur('valeur attendue parmi : ' + choix.join(', ') + '.');
    return brut;
  }
  if (type === 'json') {
    let obj;
    try { obj = JSON.parse(brut); } catch (e) { throw erreur('format JSON invalide.'); }
    return JSON.stringify(obj);
  }
  throw erreur('type inconnu.');
}

/** Contrôles de cohérence propres à certains paramètres. */
function controlerParametreMetier_(cle, valeur) {
  if (cle === 'SESSION_DUREE_HEURES') {
    const h = parseInt(valeur, 10);
    if (h < 1 || h > 24) throw new ErreurMetier('PARAMETRE_INVALIDE', 'La durée de session doit être entre 1 et 24 heures.');
  }
  if (cle === 'CONNEXION_TENTATIVES_MAX' && parseInt(valeur, 10) < 3) {
    throw new ErreurMetier('PARAMETRE_INVALIDE', 'Minimum 3 tentatives.');
  }
  if (cle === 'FRAIS_TRANCHES') {
    const t = JSON.parse(valeur);
    if (!Array.isArray(t) || !t.length) throw new ErreurMetier('PARAMETRE_INVALIDE', 'Les tranches de frais doivent être une liste.');
    let precedent = 0;
    t.forEach(function (tr, i) {
      const derniere = i === t.length - 1;
      if (derniere ? tr.jusquaCad !== null : !(tr.jusquaCad > precedent)) {
        throw new ErreurMetier('PARAMETRE_INVALIDE',
          'Tranches de frais : les plafonds doivent être croissants et la dernière tranche doit avoir « jusquaCad »: null.');
      }
      cadVersCentimes_(tr.fraisCad); // vérifie le format du montant
      if (!derniere) precedent = tr.jusquaCad;
    });
  }
}

/**
 * Liste des paramètres.
 * Admin : tous. Agents : uniquement ceux marqués « VisibleAgent ».
 */
function listerParametres_(utilisateur) {
  const estAdmin = utilisateur.Role === MBT.ROLES.ADMIN;
  return lireTable_('Parametres')
    .filter(function (p) { return estAdmin || estOui_(p.VisibleAgent); })
    .map(function (p) {
      const o = {
        cle: p.Cle, valeur: p.Valeur, type: p.Type, categorie: p.Categorie, description: p.Description
      };
      if (estAdmin) { o.modifiePar = p.ModifiePar; o.modifieLe = p.ModifieLe; o.visibleAgent = estOui_(p.VisibleAgent); }
      return o;
    });
}

/** Modification d'un paramètre par l'Admin (avec justification obligatoire). */
function modifierParametre_(utilisateur, cle, valeur, justification) {
  const motif = texteObligatoire_(justification, 'Justification', 500);
  return avecVerrou_(function () {
    const p = trouverParId_('Parametres', cle);
    if (!p) throw new ErreurMetier('INTROUVABLE', 'Paramètre inconnu : ' + cle);
    const nouvelle = normaliserValeurParametre_(p.Type, valeur, p.Cle);
    controlerParametreMetier_(cle, nouvelle);
    if (nouvelle === p.Valeur) return { cle: cle, valeur: nouvelle, inchange: true };
    const res = modifierLigne_('Parametres', cle, {
      Valeur: nouvelle, ModifiePar: utilisateur.Id, ModifieLe: maintenantUTC_()
    });
    PARAMETRES_CACHE_ = null;
    journaliser_(utilisateur, 'PARAMETRE_MODIFIE', {
      table: 'Parametres', id: cle,
      avant: { Valeur: res.avant.Valeur }, apres: { Valeur: nouvelle },
      details: { justification: motif }
    });
    return { cle: cle, valeur: nouvelle, inchange: false };
  });
}
