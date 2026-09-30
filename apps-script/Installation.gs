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
