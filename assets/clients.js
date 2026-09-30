/**
 * MBC Transfert — Écrans Clients, bénéficiaires et KYC (phase 2)
 * ---------------------------------------------------------------
 * Trois modes dans le même écran : la liste (recherche), le formulaire
 * (création / modification) et la fiche d'un client.
 * Toutes les règles (champs obligatoires, doublons, droits, vérification)
 * sont contrôlées par le serveur ; ici on ne fait que présenter.
 */
(function () {
  'use strict';
  const M = window.MBT;
  const { el, api } = M;

  const etat = {
    mode: 'liste',         // 'liste' | 'fiche' | 'formulaire'
    idFiche: null,
    clientEnEdition: null, // null = création
    recherche: '',
    statut: '',
    referentiels: null
  };

  /* ---------------------------------------------------------------
   * Outils
   * --------------------------------------------------------------- */

  async function referentiels() {
    if (!etat.referentiels) etat.referentiels = await api('clients.referentiels');
    return etat.referentiels;
  }

  function libellePiece(c) {
    const types = (etat.referentiels && etat.referentiels.typesPiece) || {};
    return c.typePiece === 'AUTRE' ? 'Autre : ' + (c.typePieceAutre || '') : (types[c.typePiece] || c.typePiece || '—');
  }

  function badgeStatut(statut) {
    const classe = { 'Vérifié': 'badge-vert', 'Bloqué': 'badge-rouge', 'Nouveau': 'badge-orange' }[statut] || '';
    return el('span', { class: 'badge ' + classe }, statut);
  }

  /** Date AAAA-MM-JJ → JJ/MM/AAAA. */
  function dateCourte(d) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
    return m ? m[3] + '/' + m[2] + '/' + m[1] : (d || '—');
  }

  function aller(mode, id) {
    etat.mode = mode;
    if (id !== undefined) etat.idFiche = id;
    M.ouvrirVue('clients');
    window.scrollTo(0, 0);
  }

  /**
   * Réduit une photo prise au téléphone (souvent 4 à 10 Mo) à une image
   * JPEG de 1600 px maximum, lisible et légère (≈ 300 Ko).
   */
  function compresserImage(fichier) {
    return new Promise((resoudre, rejeter) => {
      if (!fichier || !/^image\//.test(fichier.type)) { rejeter(new Error('Choisissez une photo (image).')); return; }
      const url = URL.createObjectURL(fichier);
      const img = new Image();
      img.onload = () => {
        const max = 1600;
        const echelle = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * echelle);
        canvas.height = Math.round(img.naturalHeight * echelle);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        resoudre({ mime: 'image/jpeg', base64: dataUrl.split(',')[1], apercu: dataUrl });
      };
      img.onerror = () => { URL.revokeObjectURL(url); rejeter(new Error('Photo illisible. Essayez une autre photo.')); };
      img.src = url;
    });
  }

  /**
   * Champ photo : bouton « Prendre / choisir une photo » + aperçu.
   * Renvoie { element, valeur() } ; valeur() donne la photo compressée ou null.
   */
  function champPhoto(libelle) {
    let photo = null;
    const apercu = el('img', { class: 'apercu-photo', alt: '', hidden: true });
    const info = el('span', { class: 'aide' }, 'Aucune photo');
    const input = el('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'input-fichier' });
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      info.textContent = 'Préparation…';
      try {
        photo = await compresserImage(f);
        apercu.src = photo.apercu;
        apercu.hidden = false;
        info.textContent = 'Photo prête (' + Math.round(photo.base64.length * 0.75 / 1024) + ' Ko)';
      } catch (e) { photo = null; apercu.hidden = true; info.textContent = e.message; }
    });
    const element = el('div', { class: 'champ-photo' },
      el('span', { class: 'libelle' }, libelle),
      el('label', { class: 'bouton bouton-discret bouton-petit' }, '📷 Prendre / choisir une photo', input),
      info, apercu);
    return { element, valeur: () => photo ? { mime: photo.mime, base64: photo.base64 } : null };
  }

  /* ---------------------------------------------------------------
   * MODE LISTE
   * --------------------------------------------------------------- */

  async function afficherListe(vue) {
    const liste = await api('clients.lister', { recherche: etat.recherche, statut: etat.statut });

    const champRecherche = el('input', { type: 'search', placeholder: 'Nom, téléphone, n° client ou n° de pièce', autocomplete: 'off', enterkeyhint: 'search' });
    champRecherche.value = etat.recherche;
    let minuterie = null;
    champRecherche.addEventListener('input', () => {
      clearTimeout(minuterie);
      minuterie = setTimeout(() => { etat.recherche = champRecherche.value.trim(); aller('liste'); }, 450);
    });

    const filtres = el('div', { class: 'puces' }, ...[['', 'Tous'], ['Nouveau', 'Nouveaux'], ['Vérifié', 'Vérifiés'], ['Bloqué', 'Bloqués']]
      .map(([val, lib]) => el('button', { type: 'button', class: 'puce', 'aria-pressed': String(etat.statut === val),
        onclick: () => { etat.statut = val; aller('liste'); } }, lib)));

    const cartes = liste.map((c) => el('li', {},
      el('button', { type: 'button', class: 'element element-cliquable', onclick: () => aller('fiche', c.id) },
        el('div', { class: 'element-titre' }, el('span', {}, c.nomComplet), badgeStatut(c.statut)),
        el('div', { class: 'element-detail' }, c.numeroClient + ' — ' + c.telephone + ' — ' + (c.ville || '')),
        (c.pieceExpiree || c.pieceExpireBientot || !c.photosCompletes) ? el('div', { class: 'rangee-badges' },
          c.pieceExpiree ? el('span', { class: 'badge badge-rouge' }, 'Pièce expirée') : null,
          c.pieceExpireBientot ? el('span', { class: 'badge badge-orange' }, 'Pièce bientôt expirée') : null,
          !c.photosCompletes ? el('span', { class: 'badge badge-orange' }, 'Photos manquantes') : null) : null)));

    vue.replaceChildren(
      el('div', { class: 'carte' },
        el('div', { class: 'element-titre' },
          el('h1', {}, 'Clients'),
          el('button', { type: 'button', class: 'bouton bouton-or', onclick: () => { etat.clientEnEdition = null; aller('formulaire'); } }, '+ Nouveau client')),
        el('label', {}, 'Rechercher', champRecherche),
        filtres),
      el('div', { class: 'carte' },
        el('p', { class: 'aide' }, liste.length + ' client(s)' + (liste.length >= 200 ? ' (200 premiers : affinez la recherche)' : '')),
        liste.length ? el('ul', { class: 'liste' }, ...cartes) : el('p', {}, 'Aucun client trouvé.')));

    if (etat.recherche) { champRecherche.focus(); champRecherche.setSelectionRange(champRecherche.value.length, champRecherche.value.length); }
  }

  /* ---------------------------------------------------------------
   * MODE FORMULAIRE (création / modification)
   * --------------------------------------------------------------- */

  async function afficherFormulaire(vue) {
    const ref = await referentiels();
    const c = etat.clientEnEdition; // null = création
    const val = (k, defaut) => (c && c[k] !== undefined && c[k] !== null ? c[k] : (defaut || ''));

    const champ = (nom, libelle, attributs, defaut) => {
      const i = el('input', Object.assign({ name: nom, autocomplete: 'off' }, attributs || {}));
      i.value = val(nom, defaut);
      return el('label', {}, libelle, i);
    };

    const selectPiece = el('select', { name: 'typePiece', required: true },
      el('option', { value: '' }, '— Choisir —'),
      ...Object.entries(ref.typesPiece).map(([k, v]) => el('option', { value: k, selected: val('typePiece') === k }, v)));
    const champAutre = champ('typePieceAutre', 'Précisez le type de pièce');
    const majAutre = () => { champAutre.hidden = selectPiece.value !== 'AUTRE'; };
    selectPiece.addEventListener('change', majAutre);
    majAutre();

    const recto = champPhoto('Pièce d\'identité — recto (face avec la photo)');
    const verso = champPhoto('Pièce d\'identité — verso (sauf passeport)');
    const erreur = el('p', { class: 'message-erreur', role: 'alert' });

    const form = el('form', { class: 'carte', novalidate: true },
      el('h1', {}, c ? 'Modifier ' + c.nomComplet : 'Nouveau client'),
      c && c.statut === 'Vérifié' ? el('p', { class: 'bandeau bandeau-orange' },
        'Ce client est vérifié. Modifier son nom, sa date de naissance ou sa pièce le fera repasser à « Nouveau » : il faudra le revérifier.') : null,
      el('h2', {}, 'Identité'),
      el('div', { class: 'grille-formulaire' },
        champ('nomComplet', 'Nom complet (comme sur la pièce)', { required: true, autocapitalize: 'words' }),
        champ('dateNaissance', 'Date de naissance', { type: 'date', required: true }),
        champ('profession', 'Profession', { required: true }),
        champ('telephone', 'Téléphone WhatsApp (avec indicatif)', { type: 'tel', required: true, inputmode: 'tel', placeholder: '+1 514… ou +226…' }),
        champ('email', 'Courriel (facultatif)', { type: 'email', inputmode: 'email' })),
      el('h2', {}, 'Adresse'),
      el('div', { class: 'grille-formulaire' },
        champ('adresse', 'Adresse', { required: true }),
        champ('ville', 'Ville', { required: true }),
        champ('pays', 'Pays de résidence', { required: true }, 'Canada')),
      el('h2', {}, 'Pièce d\'identité'),
      el('div', { class: 'grille-formulaire' },
        el('label', {}, 'Type de pièce', selectPiece),
        champAutre,
        champ('numeroPiece', 'Numéro de la pièce', { required: true, autocapitalize: 'characters' }),
        champ('expirationPiece', 'Date d\'expiration', { type: 'date', required: true }),
        champ('paysEmissionPiece', 'Pays d\'émission de la pièce', { required: true })),
      c ? el('p', { class: 'aide' }, 'Les photos de la pièce se changent depuis la fiche du client.') :
        el('div', {}, el('h2', {}, 'Photos de la pièce'),
          el('p', { class: 'aide' }, 'Facultatif maintenant, mais obligatoire pour que le client soit vérifié. Photo nette, à plat, sans reflet.'),
          recto.element, verso.element),
      el('label', {}, 'Notes (facultatif)', (() => { const t = el('textarea', { name: 'notes', rows: 3, class: 'texte-normal' }); t.value = val('notes'); return t; })()),
      erreur,
      el('div', { class: 'rangee-boutons' },
        el('button', { type: 'submit', class: 'bouton bouton-or' }, c ? 'Enregistrer' : 'Créer le client'),
        el('button', { type: 'button', class: 'bouton bouton-discret', onclick: () => aller(c ? 'fiche' : 'liste') }, 'Annuler')));

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      erreur.textContent = '';
      const d = Object.fromEntries(new FormData(form));
      if (d.typePiece !== 'AUTRE') delete d.typePieceAutre;
      try {
        if (c) {
          // On n'envoie que ce qui a changé.
          const changes = { id: c.id };
          Object.keys(d).forEach((k) => { if (String(d[k]) !== String(c[k] || '')) changes[k] = d[k]; });
          if (changes.typePiece === undefined && d.typePiece === 'AUTRE' && d.typePieceAutre !== c.typePieceAutre) {
            changes.typePiece = 'AUTRE'; changes.typePieceAutre = d.typePieceAutre;
          }
          const r = await M.pendant(form.querySelector('[type=submit]'), () => api('clients.modifier', changes));
          M.notifier(r.doitEtreReverifie ? 'Enregistré. Le client doit être revérifié.' : 'Client enregistré.');
          (r.avertissements || []).forEach((a) => M.notifier(a, true));
          aller('fiche', c.id);
        } else {
          d.photoRecto = recto.valeur();
          d.photoVerso = verso.valeur();
          const r = await M.pendant(form.querySelector('[type=submit]'), () => api('clients.creer', d));
          M.notifier('Client ' + r.numeroClient + ' créé.');
          if (r.avertissements && r.avertissements.length) setTimeout(() => M.notifier(r.avertissements.join(' '), true), 3600);
          aller('fiche', r.id);
        }
      } catch (e) { erreur.textContent = e.message; erreur.scrollIntoView({ block: 'center' }); }
    });

    vue.replaceChildren(form);
  }

  /* ---------------------------------------------------------------
   * MODE FICHE
   * --------------------------------------------------------------- */

  async function afficherPhoto(conteneur, id, face) {
    conteneur.replaceChildren(el('span', { class: 'aide' }, 'Chargement de la photo…'));
    try {
      const p = await api('clients.photo', { id, face });
      conteneur.replaceChildren(el('img', { class: 'photo-piece', src: 'data:' + p.mime + ';base64,' + p.base64, alt: 'Pièce — ' + face }));
    } catch (e) { conteneur.replaceChildren(el('span', { class: 'message-erreur' }, e.message)); }
  }

  function ligneInfo(libelle, valeur) {
    return el('div', { class: 'ligne-info' }, el('span', { class: 'aide' }, libelle), el('span', {}, valeur || '—'));
  }

  function tuile(libelle, valeur) {
    return el('div', { class: 'tuile' }, el('div', { class: 'aide' }, libelle), el('div', { class: 'tuile-valeur montant' }, valeur));
  }

  async function afficherFiche(vue) {
    await referentiels();
    const f = await api('clients.fiche', { id: etat.idFiche });
    const c = f.client;
    const admin = M.estAdmin();

    // --- En-tête et alertes ---
    const alertes = [];
    if (c.statut === 'Bloqué') alertes.push(el('p', { class: 'bandeau bandeau-rouge' }, 'Client bloqué : ' + (c.motifBlocage || '')));
    if (f.resume.pieceExpiree) alertes.push(el('p', { class: 'bandeau bandeau-rouge' }, 'Pièce d\'identité expirée le ' + dateCourte(c.expirationPiece) + ' : aucune transaction possible.'));
    else if (f.resume.pieceExpireBientot) alertes.push(el('p', { class: 'bandeau bandeau-orange' }, 'La pièce d\'identité expire le ' + dateCourte(c.expirationPiece) + '.'));
    if (c.statut === 'Nouveau' && f.manquesPourVerification.length) {
      alertes.push(el('div', { class: 'bandeau bandeau-orange' }, el('strong', {}, 'Pour pouvoir vérifier ce client :'),
        el('ul', {}, ...f.manquesPourVerification.map((m) => el('li', {}, m)))));
    }
    if (c.statut === 'Nouveau') {
      alertes.push(el('p', { class: 'aide' }, 'Non vérifié : transactions limitées à ' + M.formatCad(f.seuilVerificationCentimes) + ' (cumul sur 24 h).'));
    }
    f.avertissements.forEach((a) => alertes.push(el('p', { class: 'bandeau bandeau-orange' }, a)));

    // --- Actions Admin ---
    const actions = el('div', { class: 'rangee-boutons' },
      el('button', { type: 'button', class: 'bouton bouton-discret bouton-petit', onclick: () => { etat.clientEnEdition = c; aller('formulaire'); } }, 'Modifier'),
      admin && c.statut === 'Nouveau' ? el('button', { type: 'button', class: 'bouton bouton-vert bouton-petit', onclick: () => modaleVerification(c) }, '✔ Vérifier le client') : null,
      admin && c.statut !== 'Bloqué' ? el('button', { type: 'button', class: 'bouton bouton-rouge bouton-petit', onclick: () => modaleMotif(c, 'bloquer') }, 'Bloquer') : null,
      admin && c.statut === 'Bloqué' ? el('button', { type: 'button', class: 'bouton bouton-discret bouton-petit', onclick: () => modaleMotif(c, 'debloquer') }, 'Débloquer') : null);

    // --- Photos ---
    const blocPhoto = (face, libelle, present) => {
      const zone = el('div', { class: 'zone-photo' });
      const input = el('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'input-fichier' });
      input.addEventListener('change', async () => {
        const fichier = input.files && input.files[0];
        if (!fichier) return;
        try {
          const photo = await compresserImage(fichier);
          if (c.statut === 'Vérifié' && !confirm('Remplacer la photo fera repasser le client à « Nouveau ». Continuer ?')) return;
          zone.replaceChildren(el('span', { class: 'aide' }, 'Envoi…'));
          const r = await api('clients.televerserPhoto', { id: c.id, face, photo: { mime: photo.mime, base64: photo.base64 } });
          M.notifier(r.doitEtreReverifie ? 'Photo enregistrée. Le client doit être revérifié.' : 'Photo enregistrée.');
          aller('fiche');
        } catch (e) { M.notifier(e.message, true); zone.replaceChildren(); }
      });
      return el('div', { class: 'element' },
        el('div', { class: 'element-titre' }, el('span', {}, libelle),
          el('span', { class: 'badge ' + (present ? 'badge-vert' : 'badge-orange') }, present ? 'Enregistrée' : 'Manquante')),
        el('div', { class: 'rangee-boutons' },
          admin && present ? el('button', { type: 'button', class: 'bouton bouton-discret bouton-petit', onclick: () => afficherPhoto(zone, c.id, face) }, 'Voir') : null,
          el('label', { class: 'bouton bouton-discret bouton-petit' }, present ? 'Remplacer' : '📷 Ajouter', input)),
        zone);
    };

    // --- Bénéficiaires ---
    const listeBenef = f.beneficiaires.map((b) => el('li', { class: 'element' + (b.actif ? '' : ' inactif') },
      el('div', { class: 'element-titre' }, el('span', {}, b.nomComplet),
        b.actif ? null : el('span', { class: 'badge badge-rouge' }, 'Désactivé')),
      el('div', { class: 'element-detail' }, b.lienClient + ' — ' + b.telephone + ' — ' + b.ville + ', ' + b.pays),
      b.notes ? el('div', { class: 'element-detail' }, b.notes) : null,
      admin ? el('div', { class: 'rangee-boutons' },
        el('button', { type: 'button', class: 'bouton bouton-discret bouton-petit', onclick: async (ev) => {
          if (!confirm((b.actif ? 'Désactiver' : 'Réactiver') + ' ' + b.nomComplet + ' ?')) return;
          try { await M.pendant(ev.currentTarget, () => api('beneficiaires.modifier', { id: b.id, actif: !b.actif })); aller('fiche'); } catch (e) { M.notifier(e.message, true); }
        } }, b.actif ? 'Désactiver' : 'Réactiver')) : null));

    // --- Historique ---
    const historique = f.transactions.length
      ? el('ul', { class: 'liste' }, ...f.transactions.map((t) => el('li', { class: 'element' },
        el('div', { class: 'element-titre' }, el('span', {}, (t.numero || t.id) + ' — Flux ' + t.flux), el('span', { class: 'badge' }, t.statut)),
        el('div', { class: 'element-detail montant' }, M.formatCad(t.montantCadCentimes) + ' ⇄ ' + M.formatFcfa(t.montantFcfa) + (t.beneficiaire ? ' — ' + t.beneficiaire : '')),
        el('div', { class: 'element-detail' }, M.formatDate(t.creeLe)))))
      : el('p', { class: 'aide' }, 'Aucune transaction pour l\'instant.');

    vue.replaceChildren(
      el('button', { type: 'button', class: 'bouton bouton-discret bouton-petit lien-retour', onclick: () => aller('liste') }, '← Tous les clients'),
      el('div', { class: 'carte' },
        el('div', { class: 'element-titre' }, el('h1', {}, c.nomComplet), badgeStatut(c.statut)),
        el('p', { class: 'aide' }, c.numeroClient + (c.verifieLe ? ' — vérifié le ' + M.formatDate(c.verifieLe) : '') + ' — créé le ' + M.formatDate(c.creeLe)),
        ...alertes, actions),
      el('div', { class: 'carte' },
        el('h2', {}, 'Volumes envoyés'),
        el('div', { class: 'tuiles' },
          tuile('30 derniers jours', M.formatCad(f.totaux.total30jCentimes)),
          tuile('12 derniers mois', M.formatCad(f.totaux.total12mCentimes)),
          tuile('Dernières 24 h', M.formatCad(f.totaux.totalFenetreCentimes)),
          tuile('Transactions', String(f.totaux.nbTransactions)))),
      el('div', { class: 'carte' },
        el('h2', {}, 'Identité'),
        ligneInfo('Date de naissance', dateCourte(c.dateNaissance)),
        ligneInfo('Profession', c.profession),
        ligneInfo('Téléphone', c.telephone),
        ligneInfo('Courriel', c.email),
        ligneInfo('Adresse', [c.adresse, c.ville, c.pays].filter(Boolean).join(', ')),
        ligneInfo('Pièce', libellePiece(c)),
        ligneInfo('Numéro', c.numeroPiece),
        ligneInfo('Expire le', dateCourte(c.expirationPiece)),
        ligneInfo('Émise par', c.paysEmissionPiece),
        c.notes ? ligneInfo('Notes', c.notes) : null,
        c.telephone ? el('div', { class: 'rangee-boutons' },
          el('a', { class: 'bouton bouton-discret bouton-petit', href: 'https://wa.me/' + c.telephone.replace(/^\+/, ''), target: '_blank', rel: 'noopener' }, 'Ouvrir WhatsApp')) : null),
      el('div', { class: 'carte' },
        el('h2', {}, 'Photos de la pièce'),
        blocPhoto('recto', 'Recto', c.aPhotoRecto),
        blocPhoto('verso', c.typePiece === 'PASSEPORT' ? 'Verso (facultatif pour un passeport)' : 'Verso', c.aPhotoVerso)),
      el('div', { class: 'carte' },
        el('h2', {}, 'Bénéficiaires'),
        listeBenef.length ? el('ul', { class: 'liste' }, ...listeBenef) : el('p', { class: 'aide' }, 'Aucun bénéficiaire.'),
        formulaireBeneficiaire(c)),
      el('div', { class: 'carte' }, el('h2', {}, 'Historique des transactions'), historique));
  }

  function formulaireBeneficiaire(c) {
    const erreur = el('p', { class: 'message-erreur', role: 'alert' });
    const champ = (nom, libelle, attributs, defaut) => {
      const i = el('input', Object.assign({ name: nom, autocomplete: 'off' }, attributs || {}));
      i.value = defaut || '';
      return el('label', {}, libelle, i);
    };
    const form = el('form', { class: 'sous-formulaire', novalidate: true },
      el('div', { class: 'grille-formulaire' },
        champ('nomComplet', 'Nom complet', { required: true, autocapitalize: 'words' }),
        champ('lienClient', 'Lien avec le client (frère, mère, école…)', { required: true }),
        champ('telephone', 'Téléphone (avec indicatif)', { type: 'tel', inputmode: 'tel', required: true, placeholder: '+226…' }),
        champ('ville', 'Ville', { required: true }, 'Ouagadougou'),
        champ('pays', 'Pays', { required: true }, 'Burkina Faso'),
        champ('notes', 'Notes (facultatif)')),
      erreur,
      el('button', { type: 'submit', class: 'bouton bouton-or bouton-petit' }, 'Ajouter le bénéficiaire'));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      erreur.textContent = '';
      const d = Object.fromEntries(new FormData(form));
      d.clientId = c.id;
      try {
        await M.pendant(form.querySelector('[type=submit]'), () => api('beneficiaires.creer', d));
        M.notifier('Bénéficiaire ajouté.');
        aller('fiche');
      } catch (e) { erreur.textContent = e.message; }
    });
    return el('details', { class: 'ajout' }, el('summary', { class: 'bouton bouton-discret bouton-petit' }, '+ Ajouter un bénéficiaire'), form);
  }

  /** Vérification : photos affichées à côté des informations, case de confirmation obligatoire. */
  function modaleVerification(c) {
    const recto = el('div', { class: 'zone-photo' });
    const verso = el('div', { class: 'zone-photo' });
    const erreur = el('p', { class: 'message-erreur', role: 'alert' });
    const form = el('form', {},
      el('h2', {}, 'Vérifier ' + c.nomComplet),
      el('p', { class: 'aide' }, 'Comparez attentivement la photo de la pièce avec les informations saisies.'),
      ligneInfo('Nom', c.nomComplet),
      ligneInfo('Né(e) le', dateCourte(c.dateNaissance)),
      ligneInfo('Pièce', libellePiece(c) + ' n° ' + c.numeroPiece),
      ligneInfo('Expire le', dateCourte(c.expirationPiece)),
      c.aPhotoRecto ? recto : null,
      c.aPhotoVerso ? verso : null,
      el('label', { class: 'case' }, el('input', { type: 'checkbox', name: 'confirmation', required: true }),
        'J\'ai vérifié que la photo correspond à la personne et que le nom, la date de naissance, le numéro et la date d\'expiration sont identiques à la pièce.'),
      el('label', {}, 'Commentaire (facultatif)', el('input', { name: 'commentaire', autocomplete: 'off' })),
      erreur,
      el('div', { class: 'rangee-boutons' },
        el('button', { type: 'submit', class: 'bouton bouton-vert' }, 'Confirmer la vérification'),
        el('button', { type: 'button', class: 'bouton bouton-discret', onclick: M.fermerModale }, 'Annuler')));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      erreur.textContent = '';
      const d = new FormData(form);
      try {
        await M.pendant(form.querySelector('[type=submit]'), () => api('clients.verifier', {
          id: c.id, confirmation: d.get('confirmation') === 'on', commentaire: d.get('commentaire')
        }));
        M.fermerModale();
        M.notifier('Client vérifié.');
        aller('fiche');
      } catch (e) { erreur.textContent = e.message; }
    });
    M.ouvrirModale(form);
    if (c.aPhotoRecto) afficherPhoto(recto, c.id, 'recto');
    if (c.aPhotoVerso) afficherPhoto(verso, c.id, 'verso');
  }

  /** Blocage / déblocage avec motif obligatoire. */
  function modaleMotif(c, action) {
    const bloquer = action === 'bloquer';
    const erreur = el('p', { class: 'message-erreur', role: 'alert' });
    const form = el('form', {},
      el('h2', {}, (bloquer ? 'Bloquer ' : 'Débloquer ') + c.nomComplet),
      el('p', { class: 'aide' }, bloquer
        ? 'Un client bloqué ne peut plus faire aucune transaction.'
        : 'Le client repassera à « Nouveau » et devra être revérifié.'),
      el('label', {}, 'Motif (obligatoire, inscrit au journal)', el('input', { name: 'motif', required: true, autocomplete: 'off' })),
      erreur,
      el('div', { class: 'rangee-boutons' },
        el('button', { type: 'submit', class: 'bouton ' + (bloquer ? 'bouton-rouge' : 'bouton-or') }, bloquer ? 'Bloquer' : 'Débloquer'),
        el('button', { type: 'button', class: 'bouton bouton-discret', onclick: M.fermerModale }, 'Annuler')));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      erreur.textContent = '';
      try {
        await M.pendant(form.querySelector('[type=submit]'), () => api('clients.' + action, { id: c.id, motif: new FormData(form).get('motif') }));
        M.fermerModale();
        M.notifier(bloquer ? 'Client bloqué.' : 'Client débloqué.');
        aller('fiche');
      } catch (e) { erreur.textContent = e.message; }
    });
    M.ouvrirModale(form);
  }

  /* ---------------------------------------------------------------
   * Enregistrement de l'écran dans le menu
   * --------------------------------------------------------------- */
  M.ajouterVue('clients', {
    ordre: 20,
    titre: 'Clients',
    roles: ['ADMIN', 'AGENT_OUAGA', 'AGENT_CANADA'],
    auMenu: () => { etat.mode = 'liste'; },
    afficher: (vue) => {
      if (etat.mode === 'fiche' && etat.idFiche) return afficherFiche(vue);
      if (etat.mode === 'formulaire') return afficherFormulaire(vue);
      return afficherListe(vue);
    }
  });
})();
