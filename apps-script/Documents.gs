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
