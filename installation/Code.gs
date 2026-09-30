/**
 * MBC Transfert — serveur complet en un seul fichier.
 * Fichier GÉNÉRÉ automatiquement à partir du dossier apps-script/ : ne pas modifier à la main.
 * Copiez TOUT ce fichier dans le fichier « Code.gs » de votre projet Apps Script.
 */


/* ======================================================================
 * Api.gs
 * ====================================================================== */

/**
 * MBC Transfert — Point d'entrée du site web (API)
 * -------------------------------------------------
 * Le site (transfert.html) envoie toutes ses demandes ici, en POST :
 *   { action: 'parametres.lister', jeton: '…', donnees: { … } }
 * Réponse : { ok: true, donnees: … }  ou  { ok: false, code: '…', message: '…' }
 *
 * Pour CHAQUE action, on déclare ici quels rôles y ont droit. La vérification
 * se fait côté serveur : masquer un bouton dans le site ne suffit jamais.
 */

/**
 * Table des actions (construite à la demande : Apps Script ne garantit pas
 * l'ordre de chargement des fichiers, donc on ne lit MBT qu'à l'exécution).
 *  - public: true            → pas besoin d'être connecté (seulement la connexion)
 *  - roles: [...]             → rôles autorisés
 *  - avantChangementMdp: true → autorisée même si l'utilisateur doit encore changer son mot de passe
 *  - fn(contexte, donnees)    → la fonction à exécuter
 */
function actions_() {
  const TOUS_LES_ROLES_ = [MBT.ROLES.ADMIN, MBT.ROLES.AGENT_OUAGA, MBT.ROLES.AGENT_CANADA];
  const ADMIN_SEUL_ = [MBT.ROLES.ADMIN];
  return {
    'auth.connexion': {
      public: true,
      fn: function (ctx, d) { return connexion_(d.identifiant, d.motDePasse, d.appareil); }
    },
    'auth.moi': {
      roles: TOUS_LES_ROLES_, avantChangementMdp: true,
      fn: function (ctx) {
        return { utilisateur: profilPublic_(ctx.utilisateur), expireLe: ctx.session.ExpireLe, version: MBT.VERSION };
      }
    },
    'auth.deconnexion': {
      roles: TOUS_LES_ROLES_, avantChangementMdp: true,
      fn: function (ctx) { return deconnexion_(ctx); }
    },
    'auth.changerMotDePasse': {
      roles: TOUS_LES_ROLES_, avantChangementMdp: true,
      fn: function (ctx, d) { return changerMonMotDePasse_(ctx, d.ancien, d.nouveau); }
    },

    'parametres.lister': {
      roles: TOUS_LES_ROLES_, // l'agent ne reçoit que les paramètres « VisibleAgent » (filtré côté serveur)
      fn: function (ctx) { return listerParametres_(ctx.utilisateur); }
    },
    'parametres.modifier': {
      roles: ADMIN_SEUL_,
      fn: function (ctx, d) { return modifierParametre_(ctx.utilisateur, d.cle, d.valeur, d.justification); }
    },

    'utilisateurs.lister': {
      roles: ADMIN_SEUL_,
      fn: function () { return listerUtilisateurs_(); }
    },
    'utilisateurs.creer': {
      roles: ADMIN_SEUL_,
      fn: function (ctx, d) { return creerUtilisateur_(ctx.utilisateur, d); }
    },
    'utilisateurs.modifier': {
      roles: ADMIN_SEUL_,
      fn: function (ctx, d) { return modifierUtilisateur_(ctx.utilisateur, d); }
    },
    'utilisateurs.reinitialiserMdp': {
      roles: ADMIN_SEUL_,
      fn: function (ctx, d) { return reinitialiserMdpUtilisateur_(ctx.utilisateur, d.id); }
    },

    // --- Clients et bénéficiaires (phase 2) ---
    'clients.referentiels': {
      roles: TOUS_LES_ROLES_,
      fn: function () {
        return { typesPiece: MBT.TYPES_PIECE, statuts: MBT.STATUTS_CLIENT, typesImage: MBT.TYPES_IMAGE };
      }
    },
    'clients.lister': {
      roles: TOUS_LES_ROLES_,
      fn: function (ctx, d) { return listerClients_(d); }
    },
    'clients.fiche': {
      roles: TOUS_LES_ROLES_,
      fn: function (ctx, d) { return ficheClient_(ctx.utilisateur, d); }
    },
    'clients.creer': {
      roles: TOUS_LES_ROLES_,
      fn: function (ctx, d) { return creerClient_(ctx.utilisateur, d); }
    },
    'clients.modifier': {
      roles: TOUS_LES_ROLES_, // un agent ne peut modifier qu'un client « Nouveau » (contrôlé dans modifierClient_)
      fn: function (ctx, d) { return modifierClient_(ctx.utilisateur, d); }
    },
    'clients.televerserPhoto': {
      roles: TOUS_LES_ROLES_,
      fn: function (ctx, d) { return televerserPhotoClient_(ctx.utilisateur, d); }
    },
    'clients.photo': {
      roles: ADMIN_SEUL_,
      fn: function (ctx, d) { return photoClient_(ctx.utilisateur, d); }
    },
    'clients.verifier': {
      roles: ADMIN_SEUL_,
      fn: function (ctx, d) { return verifierClient_(ctx.utilisateur, d); }
    },
    'clients.bloquer': {
      roles: ADMIN_SEUL_,
      fn: function (ctx, d) { return bloquerClient_(ctx.utilisateur, d); }
    },
    'clients.debloquer': {
      roles: ADMIN_SEUL_,
      fn: function (ctx, d) { return debloquerClient_(ctx.utilisateur, d); }
    },
    'beneficiaires.creer': {
      roles: TOUS_LES_ROLES_,
      fn: function (ctx, d) { return creerBeneficiaire_(ctx.utilisateur, d); }
    },
    'beneficiaires.modifier': {
      roles: TOUS_LES_ROLES_, // seule la désactivation est réservée à l'Admin (contrôlé dans modifierBeneficiaire_)
      fn: function (ctx, d) { return modifierBeneficiaire_(ctx.utilisateur, d); }
    },

    // --- Taux (phase 3) ---
    'taux.etat': { roles: ADMIN_SEUL_, fn: function (ctx, d) { return etatTaux_(d); } },
    'taux.apercu': { roles: ADMIN_SEUL_, fn: function (ctx, d) { return apercuTaux_(d); } },
    'taux.saisir': { roles: ADMIN_SEUL_, fn: function (ctx, d) { return saisirTaux_(ctx.utilisateur, d); } },

    // --- Caisses (phase 3 : soldes et fonds de roulement ; complété en phase 4) ---
    'caisses.etat': { roles: ADMIN_SEUL_, fn: function () { return etatCaisses_(); } },
    'caisses.mouvements': { roles: ADMIN_SEUL_, fn: function (ctx, d) { return listerMouvements_(d); } },
    'caisses.fondsRoulement': { roles: ADMIN_SEUL_, fn: function (ctx, d) { return mouvementFondsRoulement_(ctx.utilisateur, d); } },

    // --- Transactions (phase 3) ---
    'transactions.simuler': { roles: ADMIN_SEUL_, fn: function (ctx, d) { return simulerTransaction_(d); } },
    'transactions.creer': { roles: ADMIN_SEUL_, fn: function (ctx, d) { return creerTransaction_(ctx.utilisateur, d); } },
    'transactions.lister': { roles: ADMIN_SEUL_, fn: function (ctx, d) { return listerTransactions_(d); } },
    'transactions.fiche': { roles: ADMIN_SEUL_, fn: function (ctx, d) { return ficheTransaction_(ctx.utilisateur, d); } },
    'transactions.preuve': { roles: ADMIN_SEUL_, fn: function (ctx, d) { return preuveTransaction_(ctx.utilisateur, d); } },
    'transactions.confirmerPaiement': { roles: ADMIN_SEUL_, fn: function (ctx, d) { return confirmerPaiement_(ctx.utilisateur, d); } },
    'transactions.valider': { roles: ADMIN_SEUL_, fn: function (ctx, d) { return validerTransaction_(ctx.utilisateur, d); } },
    'transactions.autoriserRemise': { roles: ADMIN_SEUL_, fn: function (ctx, d) { return autoriserRemise_(ctx.utilisateur, d); } },
    'transactions.retirerAutorisation': { roles: ADMIN_SEUL_, fn: function (ctx, d) { return retirerAutorisation_(ctx.utilisateur, d); } },
    'transactions.marquerPayee': { roles: ADMIN_SEUL_, fn: function (ctx, d) { return marquerPayee_(ctx.utilisateur, d); } },
    'transactions.cloturer': { roles: ADMIN_SEUL_, fn: function (ctx, d) { return cloturerTransaction_(ctx.utilisateur, d); } },
    'transactions.annuler': { roles: ADMIN_SEUL_, fn: function (ctx, d) { return annulerTransaction_(ctx.utilisateur, d); } },
    'transactions.rembourser': { roles: ADMIN_SEUL_, fn: function (ctx, d) { return rembourserTransaction_(ctx.utilisateur, d); } },
    'transactions.debloquer': { roles: ADMIN_SEUL_, fn: function (ctx, d) { return debloquerTransaction_(ctx.utilisateur, d); } },

    'audit.lister': {
      roles: ADMIN_SEUL_,
      fn: function (ctx, d) { return listerJournal_(d); }
    },
    'audit.verifierIntegrite': {
      roles: ADMIN_SEUL_,
      fn: function (ctx) {
        const r = verifierIntegriteJournal_();
        journaliser_(ctx.utilisateur, 'AUDIT_VERIFIE', { details: { integre: r.integre, nbEntrees: r.nbEntrees } });
        return r;
      }
    }
  };
}

/** Réponse JSON. */
function reponseJson_(objet) {
  return ContentService.createTextOutput(JSON.stringify(objet))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Toutes les demandes du site arrivent ici. */
function doPost(e) {
  return reponseJson_(traiterDemande_(e && e.postData ? e.postData.contents : ''));
}

/** Une simple visite de l'adresse de l'API ne renvoie aucune donnée. */
function doGet() {
  return reponseJson_({ ok: true, service: MBT.NOM, message: 'API active.' });
}

/**
 * Traitement d'une demande (séparé de doPost pour pouvoir être testé).
 * @param {string} corps  le texte JSON reçu
 */
function traiterDemande_(corps) {
  let nomAction = '';
  try {
    let demande;
    try { demande = JSON.parse(corps || '{}'); } catch (err) {
      throw new ErreurMetier('REQUETE_INVALIDE', 'Demande illisible.');
    }
    nomAction = String(demande.action || '');
    const actions = actions_();
    const action = Object.prototype.hasOwnProperty.call(actions, nomAction) ? actions[nomAction] : null;
    if (!action) throw new ErreurMetier('ACTION_INCONNUE', 'Action inconnue.');
    const donnees = (demande.donnees && typeof demande.donnees === 'object') ? demande.donnees : {};

    if (action.public) {
      return { ok: true, donnees: action.fn(null, donnees) };
    }

    // 1) Session valide ?  2) Mot de passe à changer ?  3) Rôle autorisé ?
    const ctx = authentifier_(demande.jeton);
    if (estOui_(ctx.utilisateur.DoitChangerMdp) && !action.avantChangementMdp) {
      throw new ErreurMetier('MDP_A_CHANGER', 'Vous devez d\'abord changer votre mot de passe.');
    }
    exigerRole_(ctx.utilisateur, action.roles);
    return { ok: true, donnees: action.fn(ctx, donnees) };
  } catch (err) {
    if (err instanceof ErreurMetier) {
      return { ok: false, code: err.code, message: err.message };
    }
    // Erreur technique : détail dans les journaux Apps Script, message neutre pour l'utilisateur.
    console.error('Erreur technique [' + nomAction + '] : ' + (err && err.stack ? err.stack : err));
    return { ok: false, code: 'ERREUR_TECHNIQUE', message: 'Une erreur technique est survenue. Réessayez ; si elle persiste, prévenez l\'administrateur.' };
  }
}


/* ======================================================================
 * Audit.gs
 * ====================================================================== */

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


/* ======================================================================
 * BaseDonnees.gs
 * ====================================================================== */

/**
 * MBC Transfert — Accès au classeur Google Sheets
 * Chaque onglet = une table. Ligne 1 = en-têtes. Une ligne = un enregistrement.
 * Toutes les cellules sont au format « texte brut » pour que Google Sheets
 * ne transforme jamais une date, un numéro de téléphone ou un montant.
 */

// Cache le temps d'une exécution (évite d'ouvrir le classeur plusieurs fois).
let CLASSEUR_CACHE_ = null;

/** Renvoie le classeur de MBC Transfert. */
function classeur_() {
  if (CLASSEUR_CACHE_) return CLASSEUR_CACHE_;
  const id = PropertiesService.getScriptProperties().getProperty(MBT.PROPRIETES.CLASSEUR_ID);
  CLASSEUR_CACHE_ = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!CLASSEUR_CACHE_) {
    throw new Error('Classeur introuvable : lancez d\'abord « Installer » depuis le menu du classeur.');
  }
  return CLASSEUR_CACHE_;
}

/** Renvoie l'onglet d'une table (erreur claire s'il manque). */
function feuille_(table) {
  const f = classeur_().getSheetByName(table);
  if (!f) throw new Error('Onglet « ' + table + ' » introuvable : relancez l\'installation.');
  return f;
}

function clePrimaire_(table) {
  return CLES_PRIMAIRES[table] || 'Id';
}

/** En-têtes réels de l'onglet (ligne 1). */
function entetes_(table) {
  const f = feuille_(table);
  const nbCol = f.getLastColumn();
  if (nbCol === 0) return [];
  return f.getRange(1, 1, 1, nbCol).getValues()[0].map(String);
}

/**
 * Protège une valeur avant écriture : un texte qui commence par = + - @
 * pourrait être interprété comme une formule (injection). On le préfixe
 * d'une apostrophe, que Google Sheets n'affiche pas et ne renvoie pas.
 */
function valeurSure_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'boolean') return v ? 'OUI' : 'NON';
  const s = String(v);
  if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) return '\'' + s;
  return s;
}

/** Valeur telle qu'elle sera relue depuis la feuille (sans l'apostrophe de protection). */
function texteStocke_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'boolean') return v ? 'OUI' : 'NON';
  return String(v);
}

/**
 * Lit toute une table et renvoie une liste d'objets { colonne: valeur }.
 * Chaque objet reçoit aussi « _ligne » (numéro de ligne dans l'onglet).
 */
function lireTable_(table) {
  const f = feuille_(table);
  const nbLignes = f.getLastRow();
  const nbCol = f.getLastColumn();
  if (nbLignes < 2 || nbCol === 0) return [];
  const valeurs = f.getRange(1, 1, nbLignes, nbCol).getValues();
  const entetes = valeurs[0].map(String);
  const resultat = [];
  for (let i = 1; i < valeurs.length; i++) {
    const obj = { _ligne: i + 1 };
    for (let j = 0; j < entetes.length; j++) {
      obj[entetes[j]] = valeurs[i][j] === null || valeurs[i][j] === undefined ? '' : String(valeurs[i][j]);
    }
    resultat.push(obj);
  }
  return resultat;
}

/** Trouve le premier enregistrement dont « champ » vaut « valeur » (ou null). */
function trouverPar_(table, champ, valeur) {
  const lignes = lireTable_(table);
  for (let i = 0; i < lignes.length; i++) {
    if (lignes[i][champ] === String(valeur)) return lignes[i];
  }
  return null;
}

/** Trouve un enregistrement par son identifiant. */
function trouverParId_(table, id) {
  return trouverPar_(table, clePrimaire_(table), id);
}

/**
 * Ajoute un enregistrement à la fin de la table.
 * Les colonnes absentes de l'objet restent vides ; les champs inconnus provoquent une erreur
 * (protection contre les fautes de frappe dans le code).
 */
function ajouterLigne_(table, objet) {
  const entetes = entetes_(table);
  Object.keys(objet).forEach(function (k) {
    if (entetes.indexOf(k) === -1) throw new Error('Colonne inconnue « ' + k + ' » dans ' + table);
  });
  const ligne = entetes.map(function (col) { return valeurSure_(objet[col]); });
  const f = feuille_(table);
  // Sous verrou : deux ajouts simultanés ne peuvent pas viser la même ligne.
  return avecVerrou_(function () {
    const numero = f.getLastRow() + 1;
    f.getRange(numero, 1, 1, ligne.length).setNumberFormat('@').setValues([ligne]);
    const copie = {};
    entetes.forEach(function (col) { copie[col] = texteStocke_(objet[col]); });
    copie._ligne = numero;
    return copie;
  });
}

/**
 * Modifie certains champs d'un enregistrement existant.
 * Renvoie { avant, apres } pour le journal d'audit.
 * Il n'existe AUCUNE fonction de suppression : c'est voulu.
 */
function modifierLigne_(table, id, changements) {
  const cle = clePrimaire_(table);
  if (Object.prototype.hasOwnProperty.call(changements, cle)) {
    throw new Error('L\'identifiant d\'un enregistrement ne peut pas être modifié.');
  }
  const entetes = entetes_(table);
  // On vérifie toutes les colonnes AVANT d'écrire quoi que ce soit (pas de modification partielle).
  Object.keys(changements).forEach(function (col) {
    if (entetes.indexOf(col) === -1) throw new Error('Colonne inconnue « ' + col + ' » dans ' + table);
  });
  return avecVerrou_(function () {
    const avant = trouverParId_(table, id);
    if (!avant) throw new ErreurMetier('INTROUVABLE', 'Enregistrement introuvable.');
    const f = feuille_(table);
    const apres = Object.assign({}, avant);
    Object.keys(changements).forEach(function (col) {
      const j = entetes.indexOf(col);
      f.getRange(avant._ligne, j + 1).setNumberFormat('@').setValue(valeurSure_(changements[col]));
      apres[col] = texteStocke_(changements[col]);
    });
    return { avant: avant, apres: apres };
  });
}

/** Lecture d'un booléen stocké « OUI » / « NON ». */
function estOui_(v) {
  return String(v).toUpperCase() === 'OUI' || v === true || String(v).toUpperCase() === 'TRUE';
}


/* ======================================================================
 * Caisses.gs
 * ====================================================================== */

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


/* ======================================================================
 * Clients.gs
 * ====================================================================== */

/**
 * MBC Transfert — Clients, bénéficiaires et KYC (« connaître son client »)
 * ------------------------------------------------------------------------
 * Règles principales :
 *  - une fiche client est complète seulement avec toutes les informations
 *    d'identité et la photo de la pièce ;
 *  - seul l'Admin peut passer un client à « Vérifié » (après contrôle des photos),
 *    le bloquer ou le débloquer ;
 *  - si l'identité d'un client vérifié change (nom, pièce, photo…), il repasse
 *    automatiquement à « Nouveau » et doit être revérifié ;
 *  - controleKycTransaction_() sera appelée à chaque transaction (phase 3) :
 *    pièce expirée ou client non vérifié au-dessus du seuil = transaction bloquée.
 *  - rien n'est jamais supprimé (un bénéficiaire se désactive).
 */

/** Champs d'identité : les modifier fait perdre le statut « Vérifié ». */
const CHAMPS_IDENTITE_ = ['NomComplet', 'DateNaissance', 'TypePiece', 'TypePieceAutre',
  'NumeroPiece', 'ExpirationPiece', 'PaysEmissionPiece', 'PhotoRectoId', 'PhotoVersoId'];

/* ------------------------------------------------------------------
 * Contrôles de saisie
 * ------------------------------------------------------------------ */

/** Téléphone : chiffres avec « + » facultatif au début, 8 à 15 chiffres. */
function normaliserTelephone_(valeur, libelle) {
  const brut = String(valeur || '').trim();
  const s = brut.replace(/[\s().\-]/g, '');
  if (!/^\+?\d{8,15}$/.test(s)) {
    throw new ErreurMetier('TELEPHONE_INVALIDE', '« ' + (libelle || 'Téléphone') +
      ' » invalide : 8 à 15 chiffres, avec l\'indicatif (ex. +1 514…, +226…).');
  }
  return s;
}

/** Date au format AAAA-MM-JJ, qui existe réellement dans le calendrier. */
function validerDate_(valeur, libelle) {
  const s = String(valeur || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  if (!d || d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
    throw new ErreurMetier('DATE_INVALIDE', '« ' + libelle + ' » : date invalide.');
  }
  return s;
}

/** Date du jour (AAAA-MM-JJ) en UTC — identique à l'heure de Ouagadougou. */
function aujourdhuiUTC_(iso) {
  return (iso || maintenantUTC_()).slice(0, 10);
}

/** Âge en années révolues à une date donnée. */
function ageEnAnnees_(dateNaissance, aujourdhui) {
  const n = dateNaissance.split('-').map(Number);
  const a = aujourdhui.split('-').map(Number);
  let age = a[0] - n[0];
  if (a[1] < n[1] || (a[1] === n[1] && a[2] < n[2])) age--;
  return age;
}

/** Nombre de jours entre aujourd'hui et une date (négatif si dépassée). */
function joursAvant_(date, aujourdhui) {
  return Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(aujourdhui + 'T00:00:00Z')) / 86400000);
}

/** Numéro de pièce comparable (majuscules, sans espaces ni tirets). */
function cleNumeroPiece_(numero) {
  return String(numero || '').toUpperCase().replace(/[\s\-.]/g, '');
}

function texteFacultatif_(valeur, libelle, longueurMax) {
  const s = String(valeur === undefined || valeur === null ? '' : valeur).trim();
  if (s.length > (longueurMax || 200)) {
    throw new ErreurMetier('CHAMP_TROP_LONG', 'Le champ « ' + libelle + ' » est trop long.');
  }
  return s;
}

/**
 * Transforme les données reçues du site en colonnes du classeur.
 * partiel = true : seuls les champs présents sont traités (modification).
 */
function champsClientDepuisSaisie_(d, partiel) {
  const c = {};
  const present = function (k) { return !partiel || Object.prototype.hasOwnProperty.call(d, k); };

  if (present('nomComplet')) c.NomComplet = texteObligatoire_(d.nomComplet, 'Nom complet', 120);
  if (present('dateNaissance')) c.DateNaissance = validerDate_(d.dateNaissance, 'Date de naissance');
  if (present('adresse')) c.Adresse = texteObligatoire_(d.adresse, 'Adresse', 250);
  if (present('ville')) c.Ville = texteObligatoire_(d.ville, 'Ville', 80);
  if (present('pays')) c.Pays = texteObligatoire_(d.pays, 'Pays', 80);
  if (present('telephone')) c.Telephone = normaliserTelephone_(d.telephone, 'Téléphone (WhatsApp)');
  if (present('email')) {
    c.Email = texteFacultatif_(d.email, 'Courriel', 120).toLowerCase();
    if (c.Email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.Email)) {
      throw new ErreurMetier('EMAIL_INVALIDE', 'Adresse courriel invalide.');
    }
  }
  if (present('profession')) c.Profession = texteObligatoire_(d.profession, 'Profession', 120);
  if (present('typePiece')) {
    if (!MBT.TYPES_PIECE[d.typePiece]) throw new ErreurMetier('PIECE_INVALIDE', 'Type de pièce d\'identité inconnu.');
    c.TypePiece = d.typePiece;
    c.TypePieceAutre = d.typePiece === 'AUTRE' ? texteObligatoire_(d.typePieceAutre, 'Précisez le type de pièce', 80) : '';
  }
  if (present('numeroPiece')) c.NumeroPiece = texteObligatoire_(d.numeroPiece, 'Numéro de pièce', 50).toUpperCase();
  if (present('expirationPiece')) c.ExpirationPiece = validerDate_(d.expirationPiece, 'Date d\'expiration de la pièce');
  if (present('paysEmissionPiece')) c.PaysEmissionPiece = texteObligatoire_(d.paysEmissionPiece, 'Pays d\'émission de la pièce', 80);
  if (present('notes')) c.Notes = texteFacultatif_(d.notes, 'Notes', 1000);

  if (c.DateNaissance) {
    const age = ageEnAnnees_(c.DateNaissance, aujourdhuiUTC_());
    const min = lireParametreEntier_('CLIENT_AGE_MIN');
    if (age < 0 || age > 120) throw new ErreurMetier('DATE_INVALIDE', 'Date de naissance invraisemblable.');
    if (min > 0 && age < min) throw new ErreurMetier('CLIENT_MINEUR', 'Le client doit avoir au moins ' + min + ' ans.');
  }
  return c;
}

/** Refuse une pièce déjà enregistrée pour un autre client. */
function verifierDoublonPiece_(typePiece, numeroPiece, idClientExclu) {
  const cle = cleNumeroPiece_(numeroPiece);
  const doublon = lireTable_('Clients').filter(function (x) {
    return x.Id !== idClientExclu && x.TypePiece === typePiece && cleNumeroPiece_(x.NumeroPiece) === cle;
  })[0];
  if (doublon) {
    throw new ErreurMetier('CLIENT_EN_DOUBLE',
      'Cette pièce d\'identité est déjà enregistrée pour le client ' + doublon.NumeroClient + ' (' + doublon.NomComplet + ').');
  }
}

/** Avertissements non bloquants (ex. même téléphone qu'un autre client). */
function avertissementsClient_(client) {
  const av = [];
  lireTable_('Clients').forEach(function (x) {
    if (x.Id !== client.Id && client.Telephone && x.Telephone === client.Telephone) {
      av.push('Même téléphone que le client ' + x.NumeroClient + ' (' + x.NomComplet + ').');
    }
  });
  return av;
}

/** Prochain numéro client lisible : CLI-000001, CLI-000002… (à appeler sous verrou). */
function prochainNumeroClient_() {
  let max = 0;
  lireTable_('Clients').forEach(function (c) {
    const m = /^CLI-(\d+)$/.exec(c.NumeroClient);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return 'CLI-' + String(max + 1).padStart(6, '0');
}

/* ------------------------------------------------------------------
 * Création / modification
 * ------------------------------------------------------------------ */

function creerClient_(u, d) {
  const champs = champsClientDepuisSaisie_(d || {}, false);
  return avecVerrou_(function () {
    verifierDoublonPiece_(champs.TypePiece, champs.NumeroPiece, null);
    const numero = prochainNumeroClient_();
    const maintenant = maintenantUTC_();
    // Photos facultatives à la création (on peut les ajouter ensuite).
    if (d.photoRecto) champs.PhotoRectoId = enregistrerPhoto_(d.photoRecto, ['Clients', numero], numero + '_piece_recto');
    if (d.photoVerso) champs.PhotoVersoId = enregistrerPhoto_(d.photoVerso, ['Clients', numero], numero + '_piece_verso');
    const client = ajouterLigne_('Clients', Object.assign(champs, {
      Id: genererId_('CLI'), NumeroClient: numero, Statut: MBT.STATUTS_CLIENT.NOUVEAU,
      CreeLe: maintenant, CreePar: u.Id
    }));
    journaliser_(u, 'CLIENT_CREE', { table: 'Clients', id: client.Id, apres: client });
    return { id: client.Id, numeroClient: numero, avertissements: avertissementsClient_(client) };
  });
}

/** Applique des changements à un client, en gérant la perte du statut « Vérifié ». */
function appliquerChangementsClient_(u, client, changements, action) {
  const identiteModifiee = CHAMPS_IDENTITE_.some(function (k) {
    return Object.prototype.hasOwnProperty.call(changements, k) && String(changements[k]) !== String(client[k] || '');
  });
  let retourNouveau = false;
  if (identiteModifiee && client.Statut === MBT.STATUTS_CLIENT.VERIFIE) {
    changements.Statut = MBT.STATUTS_CLIENT.NOUVEAU;
    changements.VerifieLe = '';
    changements.VerifiePar = '';
    retourNouveau = true;
  }
  changements.ModifieLe = maintenantUTC_();
  changements.ModifiePar = u.Id;
  const res = modifierLigne_('Clients', client.Id, changements);
  journaliserModification_(u, action, 'Clients', client.Id, res.avant, res.apres,
    retourNouveau ? { effet: 'Identité modifiée : le client doit être revérifié.' } : null);
  return { apres: res.apres, retourNouveau: retourNouveau };
}

function modifierClient_(u, d) {
  return avecVerrou_(function () {
    const client = trouverParId_('Clients', d.id);
    if (!client) throw new ErreurMetier('INTROUVABLE', 'Client introuvable.');
    // Un agent ne peut modifier qu'un client encore « Nouveau ».
    if (u.Role !== MBT.ROLES.ADMIN && client.Statut !== MBT.STATUTS_CLIENT.NOUVEAU) {
      throw new ErreurMetier('ACCES_REFUSE', 'Seul l\'Admin peut modifier un client vérifié ou bloqué.');
    }
    const saisie = Object.assign({}, d);
    delete saisie.id;
    const changements = champsClientDepuisSaisie_(saisie, true);
    const type = changements.TypePiece || client.TypePiece;
    const numero = changements.NumeroPiece || client.NumeroPiece;
    if (changements.TypePiece || changements.NumeroPiece) verifierDoublonPiece_(type, numero, client.Id);
    if (!Object.keys(changements).length) return { ok: true, inchange: true };
    const r = appliquerChangementsClient_(u, client, changements, 'CLIENT_MODIFIE');
    return { ok: true, doitEtreReverifie: r.retourNouveau, avertissements: avertissementsClient_(r.apres) };
  });
}

/** Ajoute ou remplace la photo recto ou verso de la pièce. */
function televerserPhotoClient_(u, d) {
  const face = d.face === 'verso' ? 'verso' : (d.face === 'recto' ? 'recto' : null);
  if (!face) throw new ErreurMetier('REQUETE_INVALIDE', 'Face de la pièce inconnue.');
  return avecVerrou_(function () {
    const client = trouverParId_('Clients', d.id);
    if (!client) throw new ErreurMetier('INTROUVABLE', 'Client introuvable.');
    if (u.Role !== MBT.ROLES.ADMIN && client.Statut !== MBT.STATUTS_CLIENT.NOUVEAU) {
      throw new ErreurMetier('ACCES_REFUSE', 'Seul l\'Admin peut changer la photo d\'un client vérifié ou bloqué.');
    }
    const idFichier = enregistrerPhoto_(d.photo, ['Clients', client.NumeroClient], client.NumeroClient + '_piece_' + face);
    const ch = {};
    ch[face === 'recto' ? 'PhotoRectoId' : 'PhotoVersoId'] = idFichier;
    const r = appliquerChangementsClient_(u, client, ch, 'CLIENT_PHOTO_AJOUTEE');
    return { ok: true, doitEtreReverifie: r.retourNouveau };
  });
}

/** Photo de la pièce (Admin uniquement : données sensibles). */
function photoClient_(u, d) {
  const client = trouverParId_('Clients', d.id);
  if (!client) throw new ErreurMetier('INTROUVABLE', 'Client introuvable.');
  const id = d.face === 'verso' ? client.PhotoVersoId : client.PhotoRectoId;
  const photo = lirePhoto_(id);
  journaliser_(u, 'CLIENT_PHOTO_CONSULTEE', { table: 'Clients', id: client.Id, details: { face: d.face } });
  return photo;
}

/* ------------------------------------------------------------------
 * Vérification, blocage
 * ------------------------------------------------------------------ */

/** Liste de ce qui manque pour pouvoir vérifier un client (vide = prêt). */
function manquesPourVerification_(c) {
  const m = [];
  const obligatoires = { NomComplet: 'nom', DateNaissance: 'date de naissance', Adresse: 'adresse',
    Telephone: 'téléphone', Profession: 'profession', TypePiece: 'type de pièce',
    NumeroPiece: 'numéro de pièce', ExpirationPiece: 'date d\'expiration', PaysEmissionPiece: 'pays d\'émission de la pièce' };
  Object.keys(obligatoires).forEach(function (k) { if (!c[k]) m.push('Il manque : ' + obligatoires[k] + '.'); });
  if (!c.PhotoRectoId) m.push('Il manque la photo de la pièce (recto).');
  if (!c.PhotoVersoId && c.TypePiece !== 'PASSEPORT') m.push('Il manque la photo du verso de la pièce.');
  if (c.ExpirationPiece && c.ExpirationPiece < aujourdhuiUTC_()) m.push('La pièce d\'identité est expirée.');
  return m;
}

function verifierClient_(u, d) {
  return avecVerrou_(function () {
    const c = trouverParId_('Clients', d.id);
    if (!c) throw new ErreurMetier('INTROUVABLE', 'Client introuvable.');
    if (c.Statut === MBT.STATUTS_CLIENT.BLOQUE) throw new ErreurMetier('CLIENT_BLOQUE', 'Ce client est bloqué : débloquez-le d\'abord.');
    if (c.Statut === MBT.STATUTS_CLIENT.VERIFIE) return { ok: true, inchange: true };
    if (!d.confirmation) {
      throw new ErreurMetier('CONFIRMATION_REQUISE', 'Confirmez avoir comparé les photos avec les informations saisies.');
    }
    const manques = manquesPourVerification_(c);
    if (manques.length) throw new ErreurMetier('KYC_INCOMPLET', 'Vérification impossible. ' + manques.join(' '));
    const maintenant = maintenantUTC_();
    const res = modifierLigne_('Clients', c.Id, {
      Statut: MBT.STATUTS_CLIENT.VERIFIE, VerifieLe: maintenant, VerifiePar: u.Id, ModifieLe: maintenant, ModifiePar: u.Id
    });
    journaliserModification_(u, 'CLIENT_VERIFIE', 'Clients', c.Id, res.avant, res.apres,
      { commentaire: texteFacultatif_(d.commentaire, 'Commentaire', 500) });
    return { ok: true };
  });
}

function bloquerClient_(u, d) {
  const motif = texteObligatoire_(d.motif, 'Motif du blocage', 500);
  return avecVerrou_(function () {
    const c = trouverParId_('Clients', d.id);
    if (!c) throw new ErreurMetier('INTROUVABLE', 'Client introuvable.');
    if (c.Statut === MBT.STATUTS_CLIENT.BLOQUE) return { ok: true, inchange: true };
    const res = modifierLigne_('Clients', c.Id, {
      Statut: MBT.STATUTS_CLIENT.BLOQUE, MotifBlocage: motif, ModifieLe: maintenantUTC_(), ModifiePar: u.Id
    });
    journaliserModification_(u, 'CLIENT_BLOQUE', 'Clients', c.Id, res.avant, res.apres, { motif: motif });
    return { ok: true };
  });
}

/** Déblocage : le client repasse à « Nouveau » et doit être revérifié. */
function debloquerClient_(u, d) {
  const motif = texteObligatoire_(d.motif, 'Motif du déblocage', 500);
  return avecVerrou_(function () {
    const c = trouverParId_('Clients', d.id);
    if (!c) throw new ErreurMetier('INTROUVABLE', 'Client introuvable.');
    if (c.Statut !== MBT.STATUTS_CLIENT.BLOQUE) return { ok: true, inchange: true };
    const res = modifierLigne_('Clients', c.Id, {
      Statut: MBT.STATUTS_CLIENT.NOUVEAU, MotifBlocage: '', VerifieLe: '', VerifiePar: '',
      ModifieLe: maintenantUTC_(), ModifiePar: u.Id
    });
    journaliserModification_(u, 'CLIENT_DEBLOQUE', 'Clients', c.Id, res.avant, res.apres, { motif: motif });
    return { ok: true };
  });
}

/* ------------------------------------------------------------------
 * Historique, totaux et contrôle KYC d'une transaction
 * ------------------------------------------------------------------ */

/** Statuts qui ne comptent pas dans les totaux (rien n'a réellement circulé). */
function statutsNonComptes_() {
  const S = MBT.STATUTS_TRANSACTION;
  return [S.BROUILLON, S.ANNULEE, S.REMBOURSEE];
}

/** Transactions d'un client, de la plus récente à la plus ancienne. */
function transactionsClient_(clientId) {
  return lireTable_('Transactions')
    .filter(function (t) { return t.ClientId === clientId; })
    .sort(function (a, b) { return a.CreeLe < b.CreeLe ? 1 : -1; });
}

/**
 * Montant total envoyé (équivalent CAD, en centimes) sur 30 jours, 12 mois,
 * et sur une fenêtre en heures (pour l'agrégation), à partir d'une date.
 */
function totauxClient_(clientId, maintenantIso, fenetreHeures) {
  const maintenant = Date.parse(maintenantIso || maintenantUTC_());
  const exclus = statutsNonComptes_();
  const t = { total30jCentimes: 0, total12mCentimes: 0, totalFenetreCentimes: 0, nbTransactions: 0, nb30j: 0 };
  transactionsClient_(clientId).forEach(function (x) {
    if (exclus.indexOf(x.Statut) !== -1) return;
    const montant = parseInt(x.MontantCadCentimes, 10) || 0;
    const age = maintenant - Date.parse(x.CreeLe);
    t.nbTransactions++;
    if (age <= 30 * 86400000) { t.total30jCentimes += montant; t.nb30j++; }
    if (age <= 365 * 86400000) t.total12mCentimes += montant;
    if (fenetreHeures && age <= fenetreHeures * 3600000) t.totalFenetreCentimes += montant;
  });
  return t;
}

/**
 * Contrôle KYC avant une transaction (utilisé à partir de la phase 3).
 * Le seuil de vérification s'applique au montant de la transaction AJOUTÉ aux
 * transactions du client sur la fenêtre d'agrégation (24 h par défaut) : on ne
 * peut pas éviter la vérification en fractionnant les envois.
 * Renvoie { autorise: bool, motifs: [{ code, message }] }.
 */
function controleKycTransaction_(client, montantCadCentimes, maintenantIso) {
  const motifs = [];
  const aujourdhui = aujourdhuiUTC_(maintenantIso);
  if (!client) {
    return { autorise: false, motifs: [{ code: 'CLIENT_INTROUVABLE', message: 'Client introuvable.' }] };
  }
  if (client.Statut === MBT.STATUTS_CLIENT.BLOQUE) {
    motifs.push({ code: 'CLIENT_BLOQUE', message: 'Client bloqué' + (client.MotifBlocage ? ' : ' + client.MotifBlocage : '') + '.' });
  }
  if (!client.ExpirationPiece || !client.NumeroPiece) {
    motifs.push({ code: 'KYC_INCOMPLET', message: 'Pièce d\'identité non renseignée.' });
  } else if (client.ExpirationPiece < aujourdhui) {
    motifs.push({ code: 'PIECE_EXPIREE', message: 'Pièce d\'identité expirée le ' + client.ExpirationPiece + '.' });
  }
  const fenetre = lireParametreEntier_('AGREGATION_FENETRE_HEURES');
  const cumul = totauxClient_(client.Id, maintenantIso, fenetre).totalFenetreCentimes + montantCadCentimes;
  const seuil = lireParametreCentimes_('KYC_SEUIL_VERIFICATION_CAD');
  if (client.Statut !== MBT.STATUTS_CLIENT.VERIFIE && cumul > seuil) {
    motifs.push({ code: 'CLIENT_NON_VERIFIE',
      message: 'Client non vérifié : ' + centimesVersTexte_(cumul) + ' CAD sur ' + fenetre +
        ' h dépasse le seuil de vérification (' + centimesVersTexte_(seuil) + ' CAD).' });
  }
  return { autorise: motifs.length === 0, motifs: motifs };
}

/* ------------------------------------------------------------------
 * Lecture
 * ------------------------------------------------------------------ */

/** Résumé d'un client pour les listes. */
function resumeClient_(c, aujourdhui, joursAlerte) {
  const jours = c.ExpirationPiece ? joursAvant_(c.ExpirationPiece, aujourdhui) : null;
  return {
    id: c.Id, numeroClient: c.NumeroClient, nomComplet: c.NomComplet, telephone: c.Telephone,
    ville: c.Ville, pays: c.Pays, statut: c.Statut,
    pieceExpiree: jours !== null && jours < 0,
    pieceExpireBientot: jours !== null && jours >= 0 && jours <= joursAlerte,
    photosCompletes: !!c.PhotoRectoId && (!!c.PhotoVersoId || c.TypePiece === 'PASSEPORT'),
    creeLe: c.CreeLe
  };
}

/** Recherche : nom, téléphone, numéro client ou numéro de pièce. */
function listerClients_(filtres) {
  filtres = filtres || {};
  const q = String(filtres.recherche || '').trim().toLowerCase();
  const qChiffres = q.replace(/[^\d]/g, '');
  const qPiece = cleNumeroPiece_(q);
  const aujourdhui = aujourdhuiUTC_();
  const joursAlerte = lireParametreEntier_('PIECE_ALERTE_EXPIRATION_JOURS');
  const liste = lireTable_('Clients').filter(function (c) {
    if (filtres.statut && c.Statut !== filtres.statut) return false;
    if (!q) return true;
    return c.NomComplet.toLowerCase().indexOf(q) !== -1 ||
      c.NumeroClient.toLowerCase().indexOf(q) !== -1 ||
      (qChiffres.length >= 4 && c.Telephone.indexOf(qChiffres) !== -1) ||
      (qPiece.length >= 4 && cleNumeroPiece_(c.NumeroPiece).indexOf(qPiece) !== -1);
  }).sort(function (a, b) { return a.NomComplet.localeCompare(b.NomComplet, 'fr'); });
  return liste.slice(0, 200).map(function (c) { return resumeClient_(c, aujourdhui, joursAlerte); });
}

/** Fiche complète : identité, bénéficiaires, historique, totaux, contrôle KYC. */
function ficheClient_(u, d) {
  const c = trouverParId_('Clients', d.id);
  if (!c) throw new ErreurMetier('INTROUVABLE', 'Client introuvable.');
  const aujourdhui = aujourdhuiUTC_();
  const joursAlerte = lireParametreEntier_('PIECE_ALERTE_EXPIRATION_JOURS');
  const beneficiaires = lireTable_('Beneficiaires').filter(function (b) { return b.ClientId === c.Id; });
  const nomsBenef = {};
  beneficiaires.forEach(function (b) { nomsBenef[b.Id] = b.NomComplet; });
  const totaux = totauxClient_(c.Id, null, lireParametreEntier_('AGREGATION_FENETRE_HEURES'));
  return {
    resume: resumeClient_(c, aujourdhui, joursAlerte),
    client: {
      id: c.Id, numeroClient: c.NumeroClient, nomComplet: c.NomComplet, dateNaissance: c.DateNaissance,
      adresse: c.Adresse, ville: c.Ville, pays: c.Pays, telephone: c.Telephone, email: c.Email,
      profession: c.Profession, typePiece: c.TypePiece, typePieceAutre: c.TypePieceAutre,
      numeroPiece: c.NumeroPiece, expirationPiece: c.ExpirationPiece, paysEmissionPiece: c.PaysEmissionPiece,
      aPhotoRecto: !!c.PhotoRectoId, aPhotoVerso: !!c.PhotoVersoId,
      statut: c.Statut, motifBlocage: c.MotifBlocage, verifieLe: c.VerifieLe, notes: c.Notes,
      creeLe: c.CreeLe, modifieLe: c.ModifieLe
    },
    manquesPourVerification: manquesPourVerification_(c),
    avertissements: avertissementsClient_(c),
    beneficiaires: beneficiaires.map(function (b) {
      return { id: b.Id, nomComplet: b.NomComplet, telephone: b.Telephone, ville: b.Ville, pays: b.Pays,
        lienClient: b.LienClient, actif: estOui_(b.Actif), notes: b.Notes };
    }),
    // Historique : informations visibles par tous (jamais la marge ni le revenu).
    transactions: transactionsClient_(c.Id).slice(0, 100).map(function (t) {
      return { id: t.Id, numero: t.Numero, flux: t.Flux, statut: t.Statut,
        montantCadCentimes: parseInt(t.MontantCadCentimes, 10) || 0, montantFcfa: parseInt(t.MontantFcfa, 10) || 0,
        beneficiaire: nomsBenef[t.BeneficiaireId] || '', creeLe: t.CreeLe };
    }),
    totaux: totaux,
    seuilVerificationCentimes: lireParametreCentimes_('KYC_SEUIL_VERIFICATION_CAD')
  };
}

/* ------------------------------------------------------------------
 * Bénéficiaires
 * ------------------------------------------------------------------ */

function champsBeneficiaire_(d, partiel) {
  const b = {};
  const present = function (k) { return !partiel || Object.prototype.hasOwnProperty.call(d, k); };
  if (present('nomComplet')) b.NomComplet = texteObligatoire_(d.nomComplet, 'Nom du bénéficiaire', 120);
  if (present('telephone')) b.Telephone = normaliserTelephone_(d.telephone, 'Téléphone du bénéficiaire');
  if (present('ville')) b.Ville = texteObligatoire_(d.ville, 'Ville', 80);
  if (present('pays')) b.Pays = texteObligatoire_(d.pays, 'Pays', 80);
  if (present('lienClient')) b.LienClient = texteObligatoire_(d.lienClient, 'Lien avec le client', 80);
  if (present('notes')) b.Notes = texteFacultatif_(d.notes, 'Notes', 500);
  return b;
}

function creerBeneficiaire_(u, d) {
  const champs = champsBeneficiaire_(d || {}, false);
  return avecVerrou_(function () {
    const client = trouverParId_('Clients', d.clientId);
    if (!client) throw new ErreurMetier('INTROUVABLE', 'Client introuvable.');
    const existe = lireTable_('Beneficiaires').some(function (b) {
      return b.ClientId === client.Id && estOui_(b.Actif) && b.Telephone === champs.Telephone &&
        b.NomComplet.toLowerCase() === champs.NomComplet.toLowerCase();
    });
    if (existe) throw new ErreurMetier('BENEFICIAIRE_EN_DOUBLE', 'Ce bénéficiaire existe déjà pour ce client.');
    const b = ajouterLigne_('Beneficiaires', Object.assign(champs, {
      Id: genererId_('BEN'), ClientId: client.Id, Actif: 'OUI', CreeLe: maintenantUTC_(), CreePar: u.Id
    }));
    journaliser_(u, 'BENEFICIAIRE_CREE', { table: 'Beneficiaires', id: b.Id, apres: b });
    return { id: b.Id };
  });
}

function modifierBeneficiaire_(u, d) {
  return avecVerrou_(function () {
    const b = trouverParId_('Beneficiaires', d.id);
    if (!b) throw new ErreurMetier('INTROUVABLE', 'Bénéficiaire introuvable.');
    const saisie = Object.assign({}, d);
    delete saisie.id; delete saisie.actif;
    const ch = champsBeneficiaire_(saisie, true);
    if (d.actif !== undefined) {
      if (u.Role !== MBT.ROLES.ADMIN) throw new ErreurMetier('ACCES_REFUSE', 'Seul l\'Admin peut désactiver un bénéficiaire.');
      ch.Actif = d.actif ? 'OUI' : 'NON';
    }
    if (!Object.keys(ch).length) return { ok: true, inchange: true };
    ch.ModifieLe = maintenantUTC_();
    ch.ModifiePar = u.Id;
    const res = modifierLigne_('Beneficiaires', b.Id, ch);
    journaliserModification_(u, 'BENEFICIAIRE_MODIFIE', 'Beneficiaires', b.Id, res.avant, res.apres);
    return { ok: true };
  });
}


/* ======================================================================
 * Config.gs
 * ====================================================================== */

/**
 * MBC Transfert — Configuration générale
 * ---------------------------------------
 * Ce fichier décrit :
 *  - les rôles et fuseaux horaires ;
 *  - la structure de chaque onglet (table) du classeur Google Sheets ;
 *  - les paramètres par défaut (seuils, marges, délais…).
 *
 * IMPORTANT : les valeurs des paramètres ci-dessous ne sont que des valeurs
 * de DÉPART. Elles sont copiées dans l'onglet « Parametres » à l'installation,
 * puis modifiées uniquement depuis l'écran Paramètres (Admin). Le code lit
 * toujours la valeur de l'onglet, jamais celle d'ici.
 */

const MBT = {
  VERSION: '1.2.0-phase3',
  NOM: 'MBC Transfert',

  ROLES: {
    ADMIN: 'ADMIN',
    AGENT_OUAGA: 'AGENT_OUAGA',
    AGENT_CANADA: 'AGENT_CANADA'
  },

  LIBELLES_ROLES: {
    ADMIN: 'Administrateur',
    AGENT_OUAGA: 'Agent Ouaga',
    AGENT_CANADA: 'Agent Canada'
  },

  FUSEAUX: {
    MONTREAL: 'America/Toronto',
    OUAGA: 'Africa/Ouagadougou'
  },

  // Nombre de tours de hachage des mots de passe (ralentit les attaques par force brute).
  // Stocké dans chaque empreinte : on peut l'augmenter plus tard sans casser les anciens comptes.
  HACHAGE_ITERATIONS: 1000,

  // Statuts d'un client (KYC).
  STATUTS_CLIENT: {
    NOUVEAU: 'Nouveau',
    VERIFIE: 'Vérifié',
    BLOQUE: 'Bloqué'
  },

  // Types de pièce d'identité acceptés (AUTRE : préciser laquelle).
  TYPES_PIECE: {
    CNIB: 'CNIB',
    PASSEPORT: 'Passeport',
    PERMIS: 'Permis de conduire',
    RESIDENT_PERMANENT: 'Carte de résident permanent',
    CARTE_SEJOUR: 'Carte de séjour',
    AUTRE: 'Autre'
  },

  // Statuts d'une transaction (utilisés à partir de la phase 3).
  STATUTS_TRANSACTION: {
    BROUILLON: 'Brouillon',
    EN_ATTENTE_PAIEMENT: 'En attente de paiement',
    PAIEMENT_CONFIRME: 'Paiement confirmé',
    VALIDEE: 'Validée',
    REMISE_AUTORISEE: 'Remise autorisée',
    PAYEE: 'Payée au bénéficiaire',
    CLOTUREE: 'Clôturée',
    ANNULEE: 'Annulée',
    REMBOURSEE: 'Remboursée',
    BLOQUEE_CONFORMITE: 'Bloquée conformité'
  },

  // Formats de photo acceptés.
  TYPES_IMAGE: ['image/jpeg', 'image/png', 'image/webp'],

  // Clés utilisées dans les « Propriétés du script » (stockage privé côté serveur).
  PROPRIETES: {
    CLASSEUR_ID: 'CLASSEUR_ID',
    DOSSIER_PRIVE_ID: 'DOSSIER_PRIVE_ID'
  }
};

/**
 * Structure des tables : nom de l'onglet → liste des colonnes (ligne 1).
 * La première colonne est l'identifiant unique de la ligne.
 * Conventions :
 *  - dates : texte ISO en UTC (ex. 2026-09-29T21:30:00.000Z) ;
 *  - montants CAD : entiers en CENTIMES (colonnes suffixées « Centimes ») ;
 *  - montants FCFA : entiers (colonnes suffixées « Fcfa ») ;
 *  - taux : texte décimal (ex. « 432.5000 »), calculé en entiers côté code.
 * Les tables des phases suivantes sont créées dès maintenant ; des colonnes
 * pourront être ajoutées plus tard (l'installateur les ajoute sans rien effacer).
 */
const SCHEMA = {
  Utilisateurs: [
    'Id', 'Identifiant', 'NomComplet', 'Role', 'Fuseau', 'MotDePasseHash',
    'DoitChangerMdp', 'Actif', 'TentativesEchouees', 'BloqueJusqua',
    'DerniereConnexion', 'CreeLe', 'CreePar', 'ModifieLe', 'ModifiePar'
  ],
  Sessions: [
    'Id', 'JetonHash', 'UtilisateurId', 'CreeLe', 'ExpireLe',
    'DerniereActivite', 'Active', 'Appareil', 'FermeeLe', 'MotifFermeture'
  ],
  Clients: [
    'Id', 'NumeroClient', 'NomComplet', 'DateNaissance', 'Adresse', 'Ville', 'Pays',
    'Telephone', 'Profession', 'TypePiece', 'NumeroPiece', 'ExpirationPiece',
    'PhotoRectoId', 'PhotoVersoId', 'Statut', 'Notes',
    'CreeLe', 'CreePar', 'ModifieLe', 'ModifiePar',
    // Ajouts phase 2
    'TypePieceAutre', 'PaysEmissionPiece', 'Email', 'VerifieLe', 'VerifiePar', 'MotifBlocage'
  ],
  Beneficiaires: [
    'Id', 'ClientId', 'NomComplet', 'Telephone', 'Ville', 'Pays', 'LienClient',
    'Actif', 'CreeLe', 'CreePar', 'ModifieLe', 'ModifiePar',
    // Ajouts phase 2
    'Notes'
  ],
  Taux: [
    'Id', 'DateUTC', 'TauxReference', 'MargeAType', 'MargeAValeur',
    'MargeBType', 'MargeBValeur', 'TauxFluxA', 'TauxFluxB', 'SaisiPar', 'Commentaire'
  ],
  Transactions: [
    'Id', 'Numero', 'Flux', 'Statut', 'ClientId', 'BeneficiaireId', 'EntiteId',
    'MontantCadCentimes', 'MontantFcfa', 'TauxId', 'TauxApplique', 'TauxReference',
    'FraisCadCentimes', 'FraisFcfa', 'RevenuBrutCadCentimes',
    'ProvenanceFonds', 'MotifTransfert', 'ReferenceInterac', 'CodeRetraitHash',
    'Validation1Par', 'Validation1Le', 'Validation2Par', 'Validation2Le',
    'PayableApres', 'PieceBeneficiaireNumero', 'PreuveRemiseId', 'PayeePar', 'PayeeLe',
    'TransactionOrigineId', 'Notes', 'CreeLe', 'CreePar', 'ModifieLe', 'ModifiePar',
    // Ajouts phase 3
    'TotalClientCadCentimes', 'TotalClientFcfa', 'ReferencePaiement', 'ConfirmeePar', 'ConfirmeeLe',
    'ReferenceVersement', 'TentativesCodeEchouees', 'RemiseAutoriseePar', 'RemiseAutoriseeLe',
    'MotifAnnulation', 'ClotureePar', 'ClotureeLe'
  ],
  HistoriqueStatuts: [
    'Id', 'TransactionId', 'AncienStatut', 'NouveauStatut', 'DateUTC',
    'UtilisateurId', 'Commentaire'
  ],
  Caisses: [
    'Id', 'Code', 'Nom', 'Devise', 'Actif', 'CreeLe'
  ],
  MouvementsCaisse: [
    'Id', 'CaisseId', 'DateUTC', 'JourneeLocale', 'Type', 'Montant',
    'TransactionId', 'Reference', 'Commentaire', 'CreePar'
  ],
  Rapprochements: [
    'Id', 'CaisseId', 'Journee', 'SoldeTheorique', 'SoldeCompte', 'Ecart',
    'Justification', 'SaisiPar', 'SaisiLe', 'Cloturee', 'ClotureePar', 'ClotureeLe'
  ],
  Depenses: [
    'Id', 'Mois', 'DateUTC', 'Categorie', 'Description', 'Montant', 'Devise',
    'EquivalentCadCentimes', 'Reference', 'CreePar'
  ],
  Entites: [
    'Id', 'Code', 'Nom', 'Actif', 'TauxInterne', 'Notes', 'CreeLe'
  ],
  OperationsInternes: [
    'Id', 'EntiteId', 'TransactionId', 'Sens', 'MontantCadCentimes', 'MontantFcfa',
    'Taux', 'Mois', 'Statut', 'Commentaire', 'CreeLe', 'CreePar'
  ],
  AlertesConformite: [
    'Id', 'Type', 'DateUTC', 'ClientId', 'BeneficiaireId', 'TransactionIds',
    'Description', 'MontantAgregeCadCentimes', 'Statut', 'Justification',
    'DecidePar', 'DecideLe'
  ],
  Parametres: [
    'Cle', 'Valeur', 'Type', 'Categorie', 'Description', 'VisibleAgent',
    'ModifiePar', 'ModifieLe'
  ],
  JournalAudit: [
    'Id', 'DateUTC', 'UtilisateurId', 'UtilisateurNom', 'Role', 'Action',
    'Table', 'EnregistrementId', 'AncienneValeur', 'NouvelleValeur', 'Details',
    'HashPrecedent', 'Hash'
  ]
};

/** Colonne identifiant de chaque table (par défaut « Id »). */
const CLES_PRIMAIRES = {
  Parametres: 'Cle'
};

/**
 * Colonnes qu'on ne doit JAMAIS renvoyer au navigateur ni écrire dans le journal.
 */
const COLONNES_SECRETES = ['MotDePasseHash', 'JetonHash', 'CodeRetraitHash'];

/**
 * Paramètres par défaut.
 * Types possibles :
 *  - 'entier'   : nombre entier (ex. 24)
 *  - 'decimal'  : nombre à virgule (ex. 2.5)
 *  - 'cad'      : montant en dollars canadiens, 2 décimales (ex. 1000.00)
 *  - 'fcfa'     : montant en FCFA, entier (ex. 1000000)
 *  - 'booleen'  : OUI / NON
 *  - 'texte'    : texte libre
 *  - 'choix:A|B': une valeur parmi une liste
 *  - 'json'     : structure (ex. tranches de frais)
 * visibleAgent : true si l'agent peut lire ce paramètre (ex. adresse de la boutique).
 * Les seuils réglementaires sont À CONFIRMER par le conseiller en conformité.
 */
const PARAMETRES_DEFAUT = [
  // --- Sécurité ---
  { cle: 'SESSION_DUREE_HEURES', valeur: '8', type: 'entier', categorie: 'Sécurité',
    description: 'Durée de validité d\'une session de connexion (heures).' },
  { cle: 'CONNEXION_TENTATIVES_MAX', valeur: '5', type: 'entier', categorie: 'Sécurité',
    description: 'Nombre d\'échecs de mot de passe avant blocage temporaire du compte.' },
  { cle: 'CONNEXION_BLOCAGE_MINUTES', valeur: '15', type: 'entier', categorie: 'Sécurité',
    description: 'Durée du blocage temporaire après trop d\'échecs (minutes).' },

  // --- KYC / Conformité ---
  { cle: 'KYC_SEUIL_VERIFICATION_CAD', valeur: '1000.00', type: 'cad', categorie: 'Conformité',
    description: 'Au-dessus de ce montant, le client doit avoir le statut « Vérifié ». À confirmer par le conseiller.' },
  { cle: 'KYC_SEUIL_PROVENANCE_CAD', valeur: '1000.00', type: 'cad', categorie: 'Conformité',
    description: 'Au-dessus de ce montant, « provenance des fonds » et « motif » sont obligatoires. À confirmer.' },
  { cle: 'DECLARATION_SEUIL_CAD', valeur: '10000.00', type: 'cad', categorie: 'Conformité',
    description: 'Seuil de déclaration (seul ou agrégé sur la fenêtre). À confirmer par le conseiller.' },
  { cle: 'AGREGATION_FENETRE_HEURES', valeur: '24', type: 'entier', categorie: 'Conformité',
    description: 'Fenêtre d\'agrégation des transactions d\'un même client (règle des 24 h).' },
  { cle: 'FRACTIONNEMENT_MARGE_POURCENT', valeur: '10', type: 'decimal', categorie: 'Conformité',
    description: 'Un montant est « juste sous le seuil » s\'il est à moins de ce % du seuil.' },
  { cle: 'FRACTIONNEMENT_NB_MIN', valeur: '2', type: 'entier', categorie: 'Conformité',
    description: 'Nombre de montants « juste sous le seuil » sur la fenêtre qui déclenche une alerte.' },
  { cle: 'HAUSSE_VOLUME_FACTEUR', valeur: '3', type: 'decimal', categorie: 'Conformité',
    description: 'Alerte si le volume 30 jours d\'un client dépasse X fois sa moyenne mensuelle habituelle.' },
  { cle: 'CONSERVATION_ANNEES', valeur: '5', type: 'entier', categorie: 'Conformité',
    description: 'Durée de conservation des dossiers (années). À confirmer.' },

  // --- Clients (KYC) ---
  { cle: 'CLIENT_AGE_MIN', valeur: '18', type: 'entier', categorie: 'Conformité',
    description: 'Âge minimum d\'un client (0 = pas de contrôle). À confirmer par le conseiller.' },
  { cle: 'PIECE_ALERTE_EXPIRATION_JOURS', valeur: '30', type: 'entier', categorie: 'Conformité',
    description: 'Afficher un avertissement quand la pièce d\'identité expire dans moins de X jours.' },
  { cle: 'PHOTO_TAILLE_MAX_KO', valeur: '4000', type: 'entier', categorie: 'Conformité',
    description: 'Taille maximale d\'une photo téléversée (Ko), après compression par le site.' },

  // --- Taux et marges ---
  { cle: 'TAUX_VALIDITE_HEURES', valeur: '24', type: 'entier', categorie: 'Taux',
    description: 'Si aucun taux n\'a été saisi depuis ce délai, la création de transactions est bloquée.' },
  { cle: 'MARGE_A_TYPE', valeur: 'FCFA_PAR_CAD', type: 'choix:FCFA_PAR_CAD|POURCENT', categorie: 'Taux',
    description: 'Unité de la marge du flux A (envoi CAD → FCFA).' },
  { cle: 'MARGE_A_VALEUR', valeur: '10', type: 'decimal', categorie: 'Taux',
    description: 'Marge du flux A : taux A = référence − marge.' },
  { cle: 'MARGE_B_TYPE', valeur: 'FCFA_PAR_CAD', type: 'choix:FCFA_PAR_CAD|POURCENT', categorie: 'Taux',
    description: 'Unité de la marge du flux B (achat de CAD en FCFA).' },
  { cle: 'MARGE_B_VALEUR', valeur: '10', type: 'decimal', categorie: 'Taux',
    description: 'Marge du flux B : taux B = référence + marge.' },
  { cle: 'FRAIS_TRANCHES', type: 'json', categorie: 'Taux',
    valeur: JSON.stringify([
      { jusquaCad: 500, fraisCad: 5 },
      { jusquaCad: 1500, fraisCad: 10 },
      { jusquaCad: null, fraisCad: 15 }
    ]),
    description: 'Frais fixes par transaction selon le montant (jusquaCad: null = au-delà). Exemple à ajuster.' },

  { cle: 'TAUX_ECART_ALERTE_POURCENT', valeur: '5', type: 'decimal', categorie: 'Taux',
    description: 'Un nouveau taux de référence qui s\'écarte de plus de X % du précédent demande une confirmation (anti-faute de frappe).' },

  // --- Règles anti-pertes ---
  { cle: 'DOUBLE_VALIDATION_SEUIL_CAD', valeur: '3000.00', type: 'cad', categorie: 'Anti-pertes',
    description: 'Au-dessus de ce montant, deux validations Admin sont exigées.' },
  { cle: 'NOUVEAU_CLIENT_NB_TRANSACTIONS', valeur: '3', type: 'entier', categorie: 'Anti-pertes',
    description: 'Un client est « nouveau » pendant ses N premières transactions.' },
  { cle: 'NOUVEAU_CLIENT_DELAI_HEURES', valeur: '24', type: 'entier', categorie: 'Anti-pertes',
    description: 'Délai de sécurité entre confirmation du paiement et remise, pour un nouveau client.' },

  // --- Caisses ---
  { cle: 'CAISSE_CAD_MIN', valeur: '2000.00', type: 'cad', categorie: 'Caisses',
    description: 'Solde minimum de la caisse CAD (alerte rouge en dessous).' },
  { cle: 'CAISSE_CAD_MAX', valeur: '20000.00', type: 'cad', categorie: 'Caisses',
    description: 'Solde maximum souhaité de la caisse CAD.' },
  { cle: 'CAISSE_FCFA_MIN', valeur: '1000000', type: 'fcfa', categorie: 'Caisses',
    description: 'Solde minimum de la caisse FCFA (alerte rouge en dessous).' },
  { cle: 'CAISSE_FCFA_MAX', valeur: '10000000', type: 'fcfa', categorie: 'Caisses',
    description: 'Solde maximum souhaité de la caisse FCFA.' },
  { cle: 'RAPPROCHEMENT_ALERTE_CAD', valeur: '20.00', type: 'cad', categorie: 'Caisses',
    description: 'Écart de rapprochement CAD au-delà duquel une alerte Admin est levée.' },
  { cle: 'RAPPROCHEMENT_ALERTE_FCFA', valeur: '5000', type: 'fcfa', categorie: 'Caisses',
    description: 'Écart de rapprochement FCFA au-delà duquel une alerte Admin est levée.' },

  // --- Boutique (visible par les agents, utilisé dans les messages WhatsApp) ---
  { cle: 'BOUTIQUE_NOM', valeur: 'Boutique MBC Larlé', type: 'texte', categorie: 'Boutique', visibleAgent: true,
    description: 'Nom du point de service à Ouagadougou.' },
  { cle: 'BOUTIQUE_ADRESSE', valeur: 'Larlé, Ouagadougou (adresse à compléter)', type: 'texte', categorie: 'Boutique', visibleAgent: true,
    description: 'Adresse affichée aux bénéficiaires.' },
  { cle: 'BOUTIQUE_HORAIRES', valeur: 'Lun–Sam, 8 h – 18 h (à confirmer)', type: 'texte', categorie: 'Boutique', visibleAgent: true,
    description: 'Horaires d\'ouverture.' },
  { cle: 'BOUTIQUE_TELEPHONE', valeur: '+226 00 00 00 00', type: 'texte', categorie: 'Boutique', visibleAgent: true,
    description: 'Numéro à appeler.' }
];


/* ======================================================================
 * Documents.gs
 * ====================================================================== */

/**
 * MBC Transfert — Photos et documents (Google Drive privé)
 * ---------------------------------------------------------
 * Les photos (pièces d'identité, preuves de remise) sont enregistrées dans le
 * dossier Drive privé créé à l'installation. Seul le propriétaire du compte
 * Google y a accès. Le classeur ne garde que l'identifiant du fichier.
 * Aucun fichier n'est jamais supprimé : une nouvelle photo remplace l'ancienne
 * dans la fiche, mais l'ancienne reste dans Drive (et dans le journal d'audit).
 */

/** Dossier privé racine. */
function dossierPrive_() {
  const id = PropertiesService.getScriptProperties().getProperty(MBT.PROPRIETES.DOSSIER_PRIVE_ID);
  if (!id) throw new Error('Dossier Drive privé introuvable : relancez l\'installation.');
  return DriveApp.getFolderById(id);
}

/** Sous-dossier (créé s'il n'existe pas). */
function sousDossier_(parent, nom) {
  const it = parent.getFoldersByName(nom);
  return it.hasNext() ? it.next() : parent.createFolder(nom);
}

/** Vérifie les premiers octets du fichier : c'est bien une image du type annoncé. */
function signatureImageValide_(octets, mime) {
  const b = function (i) { return octets[i] & 0xff; };
  if (octets.length < 12) return false;
  if (mime === 'image/jpeg') return b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff;
  if (mime === 'image/png') return b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47;
  if (mime === 'image/webp') {
    return b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 &&   // RIFF
      b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50;          // WEBP
  }
  return false;
}

/**
 * Enregistre une photo envoyée par le site (texte base64) dans un sous-dossier.
 * @param {Object} photo       { mime: 'image/jpeg', base64: '...' }
 * @param {string[]} chemin    sous-dossiers, ex. ['Clients', 'CLI-000001']
 * @param {string} nomFichier  nom sans extension
 * @return {string} identifiant du fichier Drive
 */
function enregistrerPhoto_(photo, chemin, nomFichier) {
  if (!photo || typeof photo.base64 !== 'string' || !photo.base64) {
    throw new ErreurMetier('PHOTO_MANQUANTE', 'Photo manquante.');
  }
  const mime = String(photo.mime || '');
  if (MBT.TYPES_IMAGE.indexOf(mime) === -1) {
    throw new ErreurMetier('PHOTO_FORMAT', 'Format de photo non accepté (JPEG, PNG ou WEBP uniquement).');
  }
  let octets;
  try { octets = Utilities.base64Decode(photo.base64); } catch (e) {
    throw new ErreurMetier('PHOTO_ILLISIBLE', 'Photo illisible.');
  }
  const maxOctets = lireParametreEntier_('PHOTO_TAILLE_MAX_KO') * 1024;
  if (octets.length > maxOctets) {
    throw new ErreurMetier('PHOTO_TROP_GRANDE', 'Photo trop lourde (maximum ' + lireParametreEntier_('PHOTO_TAILLE_MAX_KO') + ' Ko).');
  }
  if (!signatureImageValide_(octets, mime)) {
    throw new ErreurMetier('PHOTO_FORMAT', 'Le fichier envoyé n\'est pas une image valide.');
  }
  let dossier = dossierPrive_();
  chemin.forEach(function (nom) { dossier = sousDossier_(dossier, nom); });
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[mime];
  const horodatage = Utilities.formatDate(new Date(), 'UTC', 'yyyyMMdd-HHmmss');
  const fichier = dossier.createFile(Utilities.newBlob(octets, mime, nomFichier + '_' + horodatage + '.' + extension));
  return fichier.getId();
}

/** Relit une photo pour l'afficher dans le site : { mime, base64 }. */
function lirePhoto_(idFichier) {
  if (!idFichier) throw new ErreurMetier('PHOTO_MANQUANTE', 'Aucune photo enregistrée.');
  let blob;
  try { blob = DriveApp.getFileById(idFichier).getBlob(); } catch (e) {
    throw new ErreurMetier('PHOTO_INTROUVABLE', 'Photo introuvable dans Drive.');
  }
  return { mime: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) };
}


/* ======================================================================
 * Installation.gs
 * ====================================================================== */

/**
 * MBC Transfert — Installation et menu du classeur
 * -------------------------------------------------
 * Ces fonctions se lancent depuis le menu « MBC Transfert » du classeur Google Sheets
 * (visible uniquement par le propriétaire du classeur). Elles ne sont PAS accessibles
 * depuis le site web.
 *
 * « Installer » peut être relancé sans danger : il crée ce qui manque et
 * n'efface jamais de données existantes.
 */

/** Ajoute le menu « MBC Transfert » à l'ouverture du classeur. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('MBC Transfert')
    .addItem('1. Installer / mettre à jour les tables', 'installer')
    .addItem('2. Créer le compte Administrateur', 'creerAdministrateurInitial')
    .addSeparator()
    .addItem('Vérifier l\'intégrité du journal d\'audit', 'menuVerifierJournal')
    .addToUi();
}

/** Crée ou complète tous les onglets, paramètres et éléments de base. */
function installer() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getScriptProperties();
  props.setProperty(MBT.PROPRIETES.CLASSEUR_ID, ss.getId());
  CLASSEUR_CACHE_ = ss;

  const rapport = [];

  // 1) Onglets et en-têtes (JournalAudit est créé comme les autres, avant toute journalisation).
  Object.keys(SCHEMA).forEach(function (table) {
    let f = ss.getSheetByName(table);
    const colonnes = SCHEMA[table];
    if (!f) {
      f = ss.insertSheet(table);
      rapport.push('Onglet créé : ' + table);
    }
    const nbCol = f.getLastColumn();
    const existantes = nbCol ? f.getRange(1, 1, 1, nbCol).getValues()[0].map(String).filter(String) : [];
    const manquantes = colonnes.filter(function (c) { return existantes.indexOf(c) === -1; });
    if (manquantes.length) {
      f.getRange(1, existantes.length + 1, 1, manquantes.length).setValues([manquantes]);
      if (existantes.length) rapport.push(table + ' : colonnes ajoutées ' + manquantes.join(', '));
    }
    const total = existantes.length + manquantes.length;
    // Tout en texte brut : Google Sheets ne doit rien convertir (dates, numéros, montants).
    f.getRange(1, 1, f.getMaxRows(), total).setNumberFormat('@');
    f.getRange(1, 1, 1, total).setFontWeight('bold').setBackground('#1a1a1a').setFontColor('#d4af37');
    f.setFrozenRows(1);
    // Avertissement si quelqu'un tente de modifier l'onglet à la main.
    if (!f.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) {
      f.protect().setDescription('Géré par MBC Transfert — ne pas modifier à la main').setWarningOnly(true);
    }
  });

  // Supprime l'onglet vide créé par défaut par Google (« Feuille 1 » / « Sheet1 »).
  ['Feuille 1', 'Sheet1', 'Feuille1'].forEach(function (nom) {
    const f = ss.getSheetByName(nom);
    if (f && f.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(f);
  });

  // 2) Paramètres : on ajoute seulement ceux qui manquent (jamais d'écrasement).
  const existants = {};
  lireTable_('Parametres').forEach(function (p) { existants[p.Cle] = true; });
  let nbParams = 0;
  PARAMETRES_DEFAUT.forEach(function (p) {
    if (existants[p.cle]) return;
    nbParams++;
    ajouterLigne_('Parametres', {
      Cle: p.cle, Valeur: p.valeur, Type: p.type, Categorie: p.categorie,
      Description: p.description, VisibleAgent: p.visibleAgent ? 'OUI' : 'NON',
      ModifiePar: 'INSTALLATION', ModifieLe: maintenantUTC_()
    });
  });
  if (nbParams) rapport.push(nbParams + ' paramètre(s) ajouté(s).');

  // 3) Les deux caisses.
  [{ code: 'CAD', nom: 'Caisse CAD (Canada)', devise: 'CAD' },
   { code: 'FCFA', nom: 'Caisse FCFA (Larlé, Ouagadougou)', devise: 'FCFA' }].forEach(function (c) {
    if (trouverPar_('Caisses', 'Code', c.code)) return;
    ajouterLigne_('Caisses', { Id: 'CAISSE-' + c.code, Code: c.code, Nom: c.nom, Devise: c.devise,
      Actif: 'OUI', CreeLe: maintenantUTC_() });
    rapport.push('Caisse créée : ' + c.nom);
  });

  // 4) Entités du groupe (flux internes).
  [{ code: 'MBC_CARGO', nom: 'MBC Cargo' }, { code: 'LIQUIDATION_OUAGA', nom: 'Liquidation Ouaga' }]
    .forEach(function (e) {
      if (trouverPar_('Entites', 'Code', e.code)) return;
      ajouterLigne_('Entites', { Id: 'ENT-' + e.code, Code: e.code, Nom: e.nom, Actif: 'OUI', CreeLe: maintenantUTC_() });
      rapport.push('Entité créée : ' + e.nom);
    });

  // 5) Dossier Google Drive privé pour les photos (pièces d'identité, preuves de remise).
  let dossierId = props.getProperty(MBT.PROPRIETES.DOSSIER_PRIVE_ID);
  let dossierOk = false;
  if (dossierId) {
    try { DriveApp.getFolderById(dossierId).getName(); dossierOk = true; } catch (e) { dossierOk = false; }
  }
  if (!dossierOk) {
    const dossier = DriveApp.createFolder('MBC Transfert — Documents privés (NE PAS PARTAGER)');
    dossierId = dossier.getId();
    props.setProperty(MBT.PROPRIETES.DOSSIER_PRIVE_ID, dossierId);
    rapport.push('Dossier Drive privé créé.');
  }

  // 6) Tâche automatique quotidienne : fermeture des sessions expirées.
  const dejaPlanifie = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'nettoyerSessions';
  });
  if (!dejaPlanifie) {
    ScriptApp.newTrigger('nettoyerSessions').timeBased().everyDays(1).atHour(3).create();
    rapport.push('Tâche quotidienne de nettoyage des sessions planifiée.');
  }

  journaliser_(null, 'INSTALLATION', { details: { version: MBT.VERSION, actions: rapport } });

  SpreadsheetApp.getUi().alert('MBC Transfert — Installation terminée',
    (rapport.length ? rapport.join('\n') : 'Tout était déjà en place, rien à modifier.') +
    '\n\nÉtape suivante : menu MBC Transfert → « 2. Créer le compte Administrateur ».',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * Crée le tout premier compte Admin. Refusé s'il existe déjà un Admin
 * (les comptes suivants se créent depuis le site, écran Utilisateurs).
 */
function creerAdministrateurInitial() {
  const ui = SpreadsheetApp.getUi();
  if (lireTable_('Utilisateurs').some(function (u) { return u.Role === MBT.ROLES.ADMIN; })) {
    ui.alert('Un compte Administrateur existe déjà. Les autres comptes se créent depuis le site (écran Utilisateurs).');
    return;
  }
  const r1 = ui.prompt('Compte Administrateur', 'Identifiant de connexion (ex. nourou) :', ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  const r2 = ui.prompt('Compte Administrateur', 'Nom complet (ex. Nourou Maiga) :', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  try {
    const res = creerUtilisateur_(null, {
      identifiant: r1.getResponseText(), nomComplet: r2.getResponseText(),
      role: MBT.ROLES.ADMIN, fuseau: MBT.FUSEAUX.MONTREAL
    });
    ui.alert('Compte Administrateur créé',
      'Identifiant : ' + res.identifiant +
      '\nMot de passe temporaire : ' + res.motDePasseTemporaire +
      '\n\nNotez-le maintenant : il ne sera plus jamais affiché.' +
      '\nVous devrez le remplacer par votre propre mot de passe à la première connexion.',
      ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Erreur : ' + e.message);
  }
}

/** Vérifie la chaîne d'empreintes du journal d'audit et affiche le résultat. */
function menuVerifierJournal() {
  const r = verifierIntegriteJournal_();
  SpreadsheetApp.getUi().alert(r.integre ? '✅ ' + r.message : '⚠️ ALERTE : ' + r.message);
}


/* ======================================================================
 * Parametres.gs
 * ====================================================================== */

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


/* ======================================================================
 * Securite.gs
 * ====================================================================== */

/**
 * MBC Transfert — Sécurité : mots de passe, sessions, rôles
 * ----------------------------------------------------------
 * - Les mots de passe ne sont jamais stockés : seule une empreinte
 *   (SHA-256 + sel aléatoire + 1000 tours) est enregistrée.
 * - Le jeton de session remis au navigateur n'est pas stocké non plus :
 *   on garde seulement son empreinte. Une fuite du classeur ne permet donc
 *   ni de se connecter, ni de voler une session.
 * - Chaque demande vérifie : jeton valide, non expiré, compte actif, rôle autorisé.
 */

/* ------------------------- Mots de passe ------------------------- */

/** Calcule l'empreinte d'un mot de passe avec un sel et un nombre de tours. */
function hacherAvecSel_(motDePasse, sel, iterations) {
  let h = sha256Hex_(sel + ':' + motDePasse);
  for (let i = 1; i < iterations; i++) {
    h = sha256Hex_(h + ':' + sel);
  }
  return h;
}

/** Crée l'empreinte à stocker : « v1$tours$sel$empreinte ». */
function creerEmpreinteMdp_(motDePasse) {
  const sel = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const it = MBT.HACHAGE_ITERATIONS;
  return 'v1$' + it + '$' + sel + '$' + hacherAvecSel_(motDePasse, sel, it);
}

/** Vérifie un mot de passe contre l'empreinte stockée. */
function verifierMdp_(motDePasse, empreinte) {
  const p = String(empreinte || '').split('$');
  if (p.length !== 4 || p[0] !== 'v1') return false;
  const it = parseInt(p[1], 10);
  if (!(it > 0)) return false;
  return egaliteConstante_(hacherAvecSel_(String(motDePasse), p[2], it), p[3]);
}

/**
 * Règles minimales d'un mot de passe : 10 caractères, au moins une lettre et un chiffre.
 * Renvoie un message d'erreur, ou '' si le mot de passe est acceptable.
 */
function problemeMdp_(motDePasse) {
  const s = String(motDePasse || '');
  if (s.length < 10) return 'Le mot de passe doit contenir au moins 10 caractères.';
  if (s.length > 128) return 'Le mot de passe est trop long.';
  if (!/[A-Za-zÀ-ÿ]/.test(s) || !/\d/.test(s)) return 'Le mot de passe doit contenir au moins une lettre et un chiffre.';
  return '';
}

/** Mot de passe temporaire lisible (sans 0/O, 1/l/I), ex. « Kx7m-Pq4t-Wz9a ». */
function genererMdpTemporaire_() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  // L'aléatoire vient de getUuid() (générateur cryptographique côté Google).
  const hex = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  let mdp = '';
  for (let i = 0; i < 12; i++) {
    const n = parseInt(hex.substr(i * 4, 4), 16);
    mdp += alphabet.charAt(n % alphabet.length);
    if (i === 3 || i === 7) mdp += '-';
  }
  // Garantit au moins un chiffre (règle ci-dessus).
  if (!/\d/.test(mdp)) mdp = mdp.slice(0, -1) + '7';
  return mdp;
}

/* --------------------------- Sessions ---------------------------- */

/** Jeton de session : 2 UUID aléatoires = 244 bits d'aléatoire. */
function genererJeton_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

/**
 * Connexion : vérifie identifiant + mot de passe, gère le blocage après
 * trop d'échecs, crée une session. Renvoie { jeton, expireLe, utilisateur }.
 */
function connexion_(identifiant, motDePasse, appareil) {
  const ident = String(identifiant || '').trim().toLowerCase();
  const messageEchec = 'Identifiant ou mot de passe incorrect.';
  if (!ident || !motDePasse) throw new ErreurMetier('CONNEXION_ECHEC', messageEchec);

  return avecVerrou_(function () {
    const u = trouverPar_('Utilisateurs', 'Identifiant', ident);
    const maintenant = maintenantUTC_();

    if (!u) {
      journaliser_(null, 'CONNEXION_ECHEC', { nomAnonyme: ident.slice(0, 100), details: { motif: 'Identifiant inconnu' } });
      throw new ErreurMetier('CONNEXION_ECHEC', messageEchec);
    }
    if (u.BloqueJusqua && u.BloqueJusqua > maintenant) {
      journaliser_(u, 'CONNEXION_REFUSEE', { table: 'Utilisateurs', id: u.Id, details: { motif: 'Compte temporairement bloqué' } });
      throw new ErreurMetier('COMPTE_BLOQUE',
        'Trop de tentatives. Compte bloqué temporairement, réessayez plus tard.');
    }
    if (!verifierMdp_(motDePasse, u.MotDePasseHash)) {
      const echecs = (parseInt(u.TentativesEchouees, 10) || 0) + 1;
      const max = lireParametreEntier_('CONNEXION_TENTATIVES_MAX');
      const changements = { TentativesEchouees: String(echecs) };
      if (echecs >= max) {
        changements.BloqueJusqua = new Date(Date.now() +
          lireParametreEntier_('CONNEXION_BLOCAGE_MINUTES') * 60000).toISOString();
        changements.TentativesEchouees = '0';
      }
      modifierLigne_('Utilisateurs', u.Id, changements);
      journaliser_(u, 'CONNEXION_ECHEC', { table: 'Utilisateurs', id: u.Id,
        details: { motif: 'Mot de passe incorrect', tentatives: echecs, bloque: echecs >= max } });
      throw new ErreurMetier('CONNEXION_ECHEC', messageEchec);
    }
    if (!estOui_(u.Actif)) {
      // Vérifié APRÈS le mot de passe pour ne rien révéler à un inconnu.
      journaliser_(u, 'CONNEXION_REFUSEE', { table: 'Utilisateurs', id: u.Id, details: { motif: 'Compte désactivé' } });
      throw new ErreurMetier('COMPTE_INACTIF', 'Ce compte est désactivé. Contactez l\'administrateur.');
    }

    // Succès : on remet le compteur à zéro et on crée la session.
    modifierLigne_('Utilisateurs', u.Id, { TentativesEchouees: '0', BloqueJusqua: '', DerniereConnexion: maintenant });
    const jeton = genererJeton_();
    const expireLe = ajouterHeures_(maintenant, lireParametreEntier_('SESSION_DUREE_HEURES'));
    const session = ajouterLigne_('Sessions', {
      Id: genererId_('SES'),
      JetonHash: sha256Hex_(jeton),
      UtilisateurId: u.Id,
      CreeLe: maintenant,
      ExpireLe: expireLe,
      DerniereActivite: maintenant,
      Active: 'OUI',
      Appareil: String(appareil || '').slice(0, 200)
    });
    journaliser_(u, 'CONNEXION_REUSSIE', { table: 'Sessions', id: session.Id,
      details: { appareil: String(appareil || '').slice(0, 200) } });
    return { jeton: jeton, expireLe: expireLe, utilisateur: profilPublic_(u) };
  });
}

/**
 * Vérifie le jeton reçu du navigateur.
 * Renvoie { utilisateur, session } ou lance une erreur SESSION_INVALIDE.
 */
function authentifier_(jeton) {
  const invalide = new ErreurMetier('SESSION_INVALIDE', 'Session expirée ou invalide. Reconnectez-vous.');
  if (!jeton || typeof jeton !== 'string' || jeton.length < 32) throw invalide;
  const session = trouverPar_('Sessions', 'JetonHash', sha256Hex_(jeton));
  if (!session || !estOui_(session.Active)) throw invalide;
  const maintenant = maintenantUTC_();
  if (session.ExpireLe <= maintenant) {
    modifierLigne_('Sessions', session.Id, { Active: 'NON', FermeeLe: maintenant, MotifFermeture: 'Expirée' });
    throw invalide;
  }
  const u = trouverParId_('Utilisateurs', session.UtilisateurId);
  if (!u || !estOui_(u.Actif)) {
    modifierLigne_('Sessions', session.Id, { Active: 'NON', FermeeLe: maintenant, MotifFermeture: 'Compte désactivé' });
    throw invalide;
  }
  // Mise à jour de la dernière activité au plus une fois toutes les 5 minutes (limite les écritures).
  if (!session.DerniereActivite || Date.parse(maintenant) - Date.parse(session.DerniereActivite) > 5 * 60000) {
    modifierLigne_('Sessions', session.Id, { DerniereActivite: maintenant });
  }
  return { utilisateur: u, session: session };
}

/** Lance une erreur si le rôle de l'utilisateur n'est pas dans la liste autorisée. */
function exigerRole_(utilisateur, rolesAutorises) {
  if (rolesAutorises.indexOf(utilisateur.Role) === -1) {
    journaliser_(utilisateur, 'ACCES_REFUSE', { details: { rolesAutorises: rolesAutorises } });
    throw new ErreurMetier('ACCES_REFUSE', 'Vous n\'avez pas les droits pour cette action.');
  }
}

/** Ferme une session (déconnexion). */
function deconnexion_(contexte) {
  modifierLigne_('Sessions', contexte.session.Id,
    { Active: 'NON', FermeeLe: maintenantUTC_(), MotifFermeture: 'Déconnexion' });
  journaliser_(contexte.utilisateur, 'DECONNEXION', { table: 'Sessions', id: contexte.session.Id });
  return { ok: true };
}

/** Ferme toutes les sessions actives d'un utilisateur (sauf éventuellement une). */
function fermerSessionsUtilisateur_(utilisateurId, motif, sessionAGarderId) {
  const maintenant = maintenantUTC_();
  let n = 0;
  lireTable_('Sessions').forEach(function (s) {
    if (s.UtilisateurId === utilisateurId && estOui_(s.Active) && s.Id !== sessionAGarderId) {
      modifierLigne_('Sessions', s.Id, { Active: 'NON', FermeeLe: maintenant, MotifFermeture: motif });
      n++;
    }
  });
  return n;
}

/** Changement de son propre mot de passe (obligatoire à la première connexion). */
function changerMonMotDePasse_(contexte, ancien, nouveau) {
  const u = contexte.utilisateur;
  if (!verifierMdp_(ancien, u.MotDePasseHash)) {
    journaliser_(u, 'MDP_CHANGEMENT_ECHEC', { table: 'Utilisateurs', id: u.Id, details: { motif: 'Ancien mot de passe incorrect' } });
    throw new ErreurMetier('MDP_INCORRECT', 'Le mot de passe actuel est incorrect.');
  }
  const probleme = problemeMdp_(nouveau);
  if (probleme) throw new ErreurMetier('MDP_FAIBLE', probleme);
  if (ancien === nouveau) throw new ErreurMetier('MDP_IDENTIQUE', 'Le nouveau mot de passe doit être différent de l\'ancien.');
  modifierLigne_('Utilisateurs', u.Id, {
    MotDePasseHash: creerEmpreinteMdp_(nouveau), DoitChangerMdp: 'NON',
    ModifieLe: maintenantUTC_(), ModifiePar: u.Id
  });
  // Par sécurité, on ferme les autres sessions ouvertes de ce compte.
  fermerSessionsUtilisateur_(u.Id, 'Mot de passe changé', contexte.session.Id);
  journaliser_(u, 'MDP_CHANGE', { table: 'Utilisateurs', id: u.Id });
  return { ok: true };
}

/** Informations d'un utilisateur qu'on peut envoyer au navigateur. */
function profilPublic_(u) {
  return {
    id: u.Id,
    identifiant: u.Identifiant,
    nomComplet: u.NomComplet,
    role: u.Role,
    libelleRole: MBT.LIBELLES_ROLES[u.Role] || u.Role,
    fuseau: u.Fuseau,
    doitChangerMdp: estOui_(u.DoitChangerMdp)
  };
}

/** Tâche planifiée (1 fois/jour) : ferme les sessions expirées. */
function nettoyerSessions() {
  const maintenant = maintenantUTC_();
  let n = 0;
  lireTable_('Sessions').forEach(function (s) {
    if (estOui_(s.Active) && s.ExpireLe <= maintenant) {
      modifierLigne_('Sessions', s.Id, { Active: 'NON', FermeeLe: maintenant, MotifFermeture: 'Expirée' });
      n++;
    }
  });
  if (n > 0) journaliser_(null, 'SESSIONS_NETTOYEES', { details: { nombre: n } });
  return n;
}


/* ======================================================================
 * Taux.gs
 * ====================================================================== */

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


/* ======================================================================
 * Transactions.gs
 * ====================================================================== */

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


/* ======================================================================
 * Utilisateurs.gs
 * ====================================================================== */

/**
 * MBC Transfert — Gestion des utilisateurs (Admin uniquement)
 * Un utilisateur n'est jamais supprimé : on le désactive (traçabilité).
 */

function validerIdentifiant_(identifiant) {
  const s = String(identifiant || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(s)) {
    throw new ErreurMetier('IDENTIFIANT_INVALIDE',
      'Identifiant : 3 à 40 caractères, lettres minuscules sans accent, chiffres, point, tiret.');
  }
  return s;
}

function validerRole_(role) {
  if (!MBT.LIBELLES_ROLES[role]) throw new ErreurMetier('ROLE_INVALIDE', 'Rôle inconnu.');
  return role;
}

function validerFuseau_(fuseau) {
  const autorises = [MBT.FUSEAUX.MONTREAL, MBT.FUSEAUX.OUAGA];
  if (autorises.indexOf(fuseau) === -1) throw new ErreurMetier('FUSEAU_INVALIDE', 'Fuseau horaire inconnu.');
  return fuseau;
}

/** Fuseau par défaut selon le rôle. */
function fuseauParDefaut_(role) {
  return role === MBT.ROLES.AGENT_OUAGA ? MBT.FUSEAUX.OUAGA : MBT.FUSEAUX.MONTREAL;
}

function listerUtilisateurs_() {
  return lireTable_('Utilisateurs').map(function (u) {
    return {
      id: u.Id, identifiant: u.Identifiant, nomComplet: u.NomComplet, role: u.Role,
      libelleRole: MBT.LIBELLES_ROLES[u.Role] || u.Role, fuseau: u.Fuseau,
      actif: estOui_(u.Actif), doitChangerMdp: estOui_(u.DoitChangerMdp),
      bloqueJusqua: u.BloqueJusqua, derniereConnexion: u.DerniereConnexion, creeLe: u.CreeLe
    };
  });
}

/**
 * Crée un compte avec un mot de passe temporaire, affiché UNE seule fois à l'Admin.
 * L'utilisateur devra le changer à sa première connexion.
 */
function creerUtilisateur_(admin, donnees) {
  const identifiant = validerIdentifiant_(donnees.identifiant);
  const nom = texteObligatoire_(donnees.nomComplet, 'Nom complet', 100);
  const role = validerRole_(donnees.role);
  const fuseau = donnees.fuseau ? validerFuseau_(donnees.fuseau) : fuseauParDefaut_(role);
  return avecVerrou_(function () {
    if (trouverPar_('Utilisateurs', 'Identifiant', identifiant)) {
      throw new ErreurMetier('IDENTIFIANT_PRIS', 'Cet identifiant est déjà utilisé.');
    }
    const mdp = genererMdpTemporaire_();
    const u = ajouterLigne_('Utilisateurs', {
      Id: genererId_('USR'), Identifiant: identifiant, NomComplet: nom, Role: role, Fuseau: fuseau,
      MotDePasseHash: creerEmpreinteMdp_(mdp), DoitChangerMdp: 'OUI', Actif: 'OUI',
      TentativesEchouees: '0', CreeLe: maintenantUTC_(), CreePar: admin ? admin.Id : 'SYSTEME'
    });
    journaliser_(admin, 'UTILISATEUR_CREE', { table: 'Utilisateurs', id: u.Id, apres: u });
    return { id: u.Id, identifiant: identifiant, motDePasseTemporaire: mdp };
  });
}

/** Nombre d'administrateurs actifs (hors un utilisateur donné). */
function nbAdminsActifsSauf_(idExclu) {
  return lireTable_('Utilisateurs').filter(function (u) {
    return u.Id !== idExclu && u.Role === MBT.ROLES.ADMIN && estOui_(u.Actif);
  }).length;
}

/** Modifie nom, rôle, fuseau ou statut actif d'un utilisateur. */
function modifierUtilisateur_(admin, donnees) {
  return avecVerrou_(function () {
    const u = trouverParId_('Utilisateurs', donnees.id);
    if (!u) throw new ErreurMetier('INTROUVABLE', 'Utilisateur introuvable.');
    const ch = {};
    if (donnees.nomComplet !== undefined) ch.NomComplet = texteObligatoire_(donnees.nomComplet, 'Nom complet', 100);
    if (donnees.role !== undefined) ch.Role = validerRole_(donnees.role);
    if (donnees.fuseau !== undefined) ch.Fuseau = validerFuseau_(donnees.fuseau);
    if (donnees.actif !== undefined) ch.Actif = donnees.actif ? 'OUI' : 'NON';
    if (donnees.debloquer) { ch.BloqueJusqua = ''; ch.TentativesEchouees = '0'; }

    // Garde-fous : on ne peut pas se retirer soi-même ses droits, ni supprimer le dernier Admin.
    const retireAdmin = (ch.Role && ch.Role !== MBT.ROLES.ADMIN) || ch.Actif === 'NON';
    if (retireAdmin && u.Role === MBT.ROLES.ADMIN) {
      if (u.Id === admin.Id) throw new ErreurMetier('INTERDIT', 'Vous ne pouvez pas retirer vos propres droits Admin ni désactiver votre compte.');
      if (nbAdminsActifsSauf_(u.Id) === 0) throw new ErreurMetier('INTERDIT', 'Il doit rester au moins un Admin actif.');
    }
    if (!Object.keys(ch).length) return { ok: true, inchange: true };
    ch.ModifieLe = maintenantUTC_();
    ch.ModifiePar = admin.Id;
    const res = modifierLigne_('Utilisateurs', u.Id, ch);
    // Changement de rôle ou désactivation : on coupe les sessions ouvertes.
    if (ch.Actif === 'NON' || (ch.Role && ch.Role !== u.Role)) {
      fermerSessionsUtilisateur_(u.Id, 'Droits modifiés par l\'Admin');
    }
    journaliserModification_(admin, 'UTILISATEUR_MODIFIE', 'Utilisateurs', u.Id, res.avant, res.apres);
    return { ok: true };
  });
}

/** Réinitialise le mot de passe : nouveau mot de passe temporaire affiché une fois. */
function reinitialiserMdpUtilisateur_(admin, id) {
  return avecVerrou_(function () {
    const u = trouverParId_('Utilisateurs', id);
    if (!u) throw new ErreurMetier('INTROUVABLE', 'Utilisateur introuvable.');
    const mdp = genererMdpTemporaire_();
    modifierLigne_('Utilisateurs', u.Id, {
      MotDePasseHash: creerEmpreinteMdp_(mdp), DoitChangerMdp: 'OUI',
      TentativesEchouees: '0', BloqueJusqua: '', ModifieLe: maintenantUTC_(), ModifiePar: admin.Id
    });
    fermerSessionsUtilisateur_(u.Id, 'Mot de passe réinitialisé');
    journaliser_(admin, 'MDP_REINITIALISE', { table: 'Utilisateurs', id: u.Id });
    return { id: u.Id, identifiant: u.Identifiant, motDePasseTemporaire: mdp };
  });
}


/* ======================================================================
 * Utilitaires.gs
 * ====================================================================== */

/**
 * MBC Transfert — Utilitaires communs
 * Erreurs, dates UTC, montants en entiers, identifiants, verrous.
 */

/**
 * Erreur « métier » : son message est destiné à l'utilisateur (en français).
 * Toute autre erreur est considérée comme technique : le détail est gardé
 * dans les journaux Apps Script et l'utilisateur voit un message générique.
 */
class ErreurMetier extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ErreurMetier';
    this.code = code;
  }
}

/** Date/heure actuelle en texte ISO UTC. */
function maintenantUTC_() {
  return new Date().toISOString();
}

/** Ajoute des heures à une date ISO et renvoie une date ISO. */
function ajouterHeures_(iso, heures) {
  return new Date(new Date(iso).getTime() + heures * 3600 * 1000).toISOString();
}

/** Journée locale (AAAA-MM-JJ) dans un fuseau donné — utile pour les clôtures de caisse. */
function journeeLocale_(iso, fuseau) {
  return Utilities.formatDate(new Date(iso), fuseau, 'yyyy-MM-dd');
}

/**
 * Génère un identifiant unique (préfixe + date compacte + aléatoire).
 * Ex. : USR-20260929-9F3A1C2B
 */
function genererId_(prefixe) {
  const date = Utilities.formatDate(new Date(), 'UTC', 'yyyyMMdd');
  const alea = Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
  return prefixe + '-' + date + '-' + alea;
}

/** Octets (signés, comme renvoyés par Apps Script) → texte hexadécimal. */
function octetsVersHex_(octets) {
  let hex = '';
  for (let i = 0; i < octets.length; i++) {
    const b = octets[i] & 0xff;
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

/** Empreinte SHA-256 d'un texte, en hexadécimal. */
function sha256Hex_(texte) {
  const octets = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, String(texte), Utilities.Charset.UTF_8);
  return octetsVersHex_(octets);
}

/** Comparaison de deux textes en temps constant (évite les attaques par mesure du temps). */
function egaliteConstante_(a, b) {
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/* ------------------------------------------------------------------
 * MONTANTS — on ne calcule JAMAIS avec des nombres à virgule.
 * CAD → entiers en centimes ; FCFA → entiers.
 * ------------------------------------------------------------------ */

/**
 * Convertit un texte « 1250,5 » / « 1 250.50 » / 1250.5 en centimes (125050).
 * Refuse plus de 2 décimales, les lettres et les montants négatifs (sauf si autoriserNegatif).
 */
function cadVersCentimes_(valeur, autoriserNegatif) {
  let s = String(valeur === undefined || valeur === null ? '' : valeur)
    .trim().replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  let signe = 1;
  if (s.charAt(0) === '-') {
    if (!autoriserNegatif) throw new ErreurMetier('MONTANT_INVALIDE', 'Le montant ne peut pas être négatif.');
    signe = -1; s = s.slice(1);
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    throw new ErreurMetier('MONTANT_INVALIDE', 'Montant CAD invalide : « ' + valeur + ' » (2 décimales maximum).');
  }
  const parties = s.split('.');
  const entier = parseInt(parties[0], 10);
  const dec = parties[1] ? parseInt((parties[1] + '0').slice(0, 2), 10) : 0;
  const total = entier * 100 + dec;
  if (!Number.isSafeInteger(total)) throw new ErreurMetier('MONTANT_INVALIDE', 'Montant trop grand.');
  return signe * total;
}

/** Centimes → texte « 1250.50 » (format de stockage, point décimal). */
function centimesVersTexte_(centimes) {
  const n = Math.round(Number(centimes));
  const signe = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return signe + Math.floor(abs / 100) + '.' + String(abs % 100).padStart(2, '0');
}

/** Convertit un texte en montant FCFA entier (refuse les décimales). */
function fcfaVersEntier_(valeur, autoriserNegatif) {
  let s = String(valeur === undefined || valeur === null ? '' : valeur)
    .trim().replace(/[\s\u00a0\u202f]/g, '');
  let signe = 1;
  if (s.charAt(0) === '-') {
    if (!autoriserNegatif) throw new ErreurMetier('MONTANT_INVALIDE', 'Le montant ne peut pas être négatif.');
    signe = -1; s = s.slice(1);
  }
  if (!/^\d+$/.test(s)) {
    throw new ErreurMetier('MONTANT_INVALIDE', 'Montant FCFA invalide : « ' + valeur + ' » (nombre entier attendu).');
  }
  const n = parseInt(s, 10);
  if (!Number.isSafeInteger(n)) throw new ErreurMetier('MONTANT_INVALIDE', 'Montant trop grand.');
  return signe * n;
}

/* ------------------------------------------------------------------
 * VERROU — toute écriture sensible passe par ici pour éviter que deux
 * personnes modifient la même chose au même instant.
 * ------------------------------------------------------------------ */
let PROFONDEUR_VERROU_ = 0; // permet d'imbriquer avecVerrou_ sans se bloquer soi-même

function avecVerrou_(fonction) {
  if (PROFONDEUR_VERROU_ > 0) {
    // Le verrou est déjà détenu par cette exécution : on continue simplement.
    PROFONDEUR_VERROU_++;
    try { return fonction(); } finally { PROFONDEUR_VERROU_--; }
  }
  const verrou = LockService.getScriptLock();
  if (!verrou.tryLock(20000)) {
    throw new ErreurMetier('OCCUPE', 'Le système est occupé, réessayez dans quelques secondes.');
  }
  PROFONDEUR_VERROU_ = 1;
  try {
    return fonction();
  } finally {
    PROFONDEUR_VERROU_ = 0;
    SpreadsheetApp.flush();
    verrou.releaseLock();
  }
}

/** Retire les colonnes secrètes d'un objet avant de l'envoyer ou de le journaliser. */
function sansSecrets_(objet) {
  if (!objet) return objet;
  const copie = {};
  Object.keys(objet).forEach(function (k) {
    if (k.charAt(0) === '_') return;          // champs techniques internes (ex. _ligne)
    if (COLONNES_SECRETES.indexOf(k) !== -1) return;
    copie[k] = objet[k];
  });
  return copie;
}

/** Vérifie qu'un champ texte obligatoire est rempli et le nettoie. */
function texteObligatoire_(valeur, libelle, longueurMax) {
  const s = String(valeur === undefined || valeur === null ? '' : valeur).trim();
  if (!s) throw new ErreurMetier('CHAMP_OBLIGATOIRE', 'Le champ « ' + libelle + ' » est obligatoire.');
  if (s.length > (longueurMax || 200)) {
    throw new ErreurMetier('CHAMP_TROP_LONG', 'Le champ « ' + libelle + ' » est trop long.');
  }
  return s;
}
