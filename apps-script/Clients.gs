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
