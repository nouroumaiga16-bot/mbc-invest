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
  // Calcul fait directement en JavaScript : environ 100 fois plus rapide que
  // Utilities.computeDigest (qui passe par un service Google à chaque appel).
  // Résultat identique au SHA-256 standard (texte encodé en UTF-8).
  return sha256JsHex_(String(texte));
}

/* SHA-256 standard (FIPS 180-4) en JavaScript pur. */
const SHA256_K_ = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

/** Texte → liste d'octets UTF-8. */
function utf8Octets_(texte) {
  const octets = [];
  for (let i = 0; i < texte.length; i++) {
    let c = texte.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < texte.length) {
      const c2 = texte.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00); i++; }
    }
    if (c < 0x80) octets.push(c);
    else if (c < 0x800) octets.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) octets.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else octets.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return octets;
}

function sha256JsHex_(texte) {
  const m = utf8Octets_(texte);
  const longueurBits = m.length * 8;
  m.push(0x80);
  while (m.length % 64 !== 56) m.push(0);
  const haut = Math.floor(longueurBits / 0x100000000);
  const bas = longueurBits >>> 0;
  m.push((haut >>> 24) & 255, (haut >>> 16) & 255, (haut >>> 8) & 255, haut & 255,
    (bas >>> 24) & 255, (bas >>> 16) & 255, (bas >>> 8) & 255, bas & 255);
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const W = new Array(64);
  const rotr = function (x, n) { return (x >>> n) | (x << (32 - n)); };
  for (let bloc = 0; bloc < m.length; bloc += 64) {
    for (let t = 0; t < 16; t++) {
      const j = bloc + t * 4;
      W[t] = ((m[j] << 24) | (m[j + 1] << 16) | (m[j + 2] << 8) | m[j + 3]) | 0;
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
      const s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA256_K_[t] + W[t]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  let hex = '';
  for (let i = 0; i < 8; i++) hex += ('00000000' + (H[i] >>> 0).toString(16)).slice(-8);
  return hex;
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
  // Sous verrou, on relit toujours le classeur : aucune donnée d'avant le verrou n'est réutilisée.
  viderCacheTables_();
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
