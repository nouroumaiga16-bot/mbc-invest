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
