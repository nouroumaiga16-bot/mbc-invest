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
