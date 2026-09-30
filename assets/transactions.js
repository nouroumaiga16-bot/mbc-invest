/**
 * MBC Transfert — Écrans Transactions, Taux et Caisses (phase 3)
 * ----------------------------------------------------------------
 * Le site ne calcule rien d'important : les montants viennent du serveur
 * (simulation), et chaque étape du cycle de vie est contrôlée côté serveur.
 */
(function () {
  'use strict';
  const M = window.MBT;
  const { el, api } = M;

  /* ================================================================
   * Outils communs
   * ================================================================ */

  const COULEURS_STATUT = {
    'En attente de paiement': 'badge-orange', 'Paiement confirmé': 'badge-orange', 'Validée': '',
    'Remise autorisée': 'badge-orange', 'Payée au bénéficiaire': 'badge-vert', 'Clôturée': 'badge-vert',
    'Annulée': 'badge-rouge', 'Remboursée': 'badge-rouge', 'Bloquée conformité': 'badge-rouge'
  };
  const badgeStatut = (s) => el('span', { class: 'badge ' + (COULEURS_STATUT[s] || '') }, s);
  const LIBELLE_FLUX = { A: 'A — Envoi CAD → FCFA', B: 'B — Achat de CAD (FCFA → CAD)' };

  /** « 430.0000 » → « 430 » ; « 441.2567 » → « 441,2567 ». */
  function tauxLisible(t) {
    const s = String(t || '').replace(/\.?0+$/, '');
    return s.replace('.', ',') + ' FCFA/CAD';
  }

  function ligneInfo(libelle, valeur) {
    return el('div', { class: 'ligne-info' }, el('span', { class: 'aide' }, libelle), el('span', { class: 'valeur' }, valeur || '—'));
  }

  function champ(nom, libelle, attributs, valeurDefaut) {
    const i = el('input', Object.assign({ name: nom, autocomplete: 'off' }, attributs || {}));
    if (valeurDefaut !== undefined) i.value = valeurDefaut;
    return el('label', {}, libelle, i);
  }

  /** Compression d'une photo (même méthode que les pièces d'identité). */
  function compresserImage(fichier) {
    return new Promise((ok, ko) => {
      if (!fichier || !/^image\//.test(fichier.type)) { ko(new Error('Choisissez une photo.')); return; }
      const url = URL.createObjectURL(fichier);
      const img = new Image();
      img.onload = () => {
        const e = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * e); c.height = Math.round(img.naturalHeight * e);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        const d = c.toDataURL('image/jpeg', 0.82);
        ok({ mime: 'image/jpeg', base64: d.split(',')[1], apercu: d });
      };
      img.onerror = () => { URL.revokeObjectURL(url); ko(new Error('Photo illisible.')); };
      img.src = url;
    });
  }

  function champPhoto(libelle) {
    let photo = null;
    const apercu = el('img', { class: 'apercu-photo', alt: '', hidden: true });
    const info = el('span', { class: 'aide' }, 'Aucune photo');
    const input = el('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'input-fichier' });
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      try { photo = await compresserImage(f); apercu.src = photo.apercu; apercu.hidden = false; info.textContent = 'Photo prête'; } catch (e) { photo = null; info.textContent = e.message; }
    });
    return {
      element: el('div', { class: 'champ-photo' }, el('span', { class: 'libelle' }, libelle),
        el('label', { class: 'bouton bouton-discret bouton-petit' }, '📷 Prendre / choisir une photo', input), info, apercu),
      valeur: () => photo ? { mime: photo.mime, base64: photo.base64 } : null
    };
  }

  /**
   * Fenêtre avec formulaire : titre, champs, bouton d'envoi.
   * envoyer(FormData, formulaire) renvoie une promesse ; en cas d'erreur, le message s'affiche.
   */
  function modaleFormulaire(titre, contenu, libelleBouton, envoyer, classeBouton) {
    const erreur = el('p', { class: 'message-erreur', role: 'alert' });
    const form = el('form', { novalidate: true }, el('h2', {}, titre), ...contenu, erreur,
      el('div', { class: 'rangee-boutons' },
        el('button', { type: 'submit', class: 'bouton ' + (classeBouton || 'bouton-or') }, libelleBouton),
        el('button', { type: 'button', class: 'bouton bouton-discret', onclick: M.fermerModale }, 'Annuler')));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      erreur.textContent = '';
      try { await M.pendant(form.querySelector('[type=submit]'), () => envoyer(new FormData(form), form)); } catch (e) { erreur.textContent = e.message; }
    });
    M.ouvrirModale(form);
    return form;
  }

  /* ================================================================
   * ÉCRAN TRANSACTIONS
   * ================================================================ */

  const etat = { mode: 'liste', id: null, statut: 'EN_COURS', recherche: '' };

  function aller(mode, id) {
    etat.mode = mode;
    if (id !== undefined) etat.id = id;
    M.ouvrirVue('transactions');
    window.scrollTo(0, 0);
  }

  async function bandeauTaux() {
    try {
      const t = await api('taux.etat', { limite: 1 });
      if (!t.actuel) return el('p', { class: 'bandeau bandeau-rouge' }, 'Aucun taux saisi : menu Taux → saisir le taux du jour avant de créer une transaction.');
      if (t.actuel.perime) return el('p', { class: 'bandeau bandeau-rouge' }, 'Taux de plus de ' + t.validiteHeures + ' h : saisissez le taux du jour (menu Taux).');
      return el('p', { class: 'aide' }, 'Taux du jour : A ' + tauxLisible(t.actuel.tauxFluxA) + ' — B ' + tauxLisible(t.actuel.tauxFluxB));
    } catch (e) { return null; }
  }

  async function afficherListe(vue) {
    const [liste, bandeau] = await Promise.all([api('transactions.lister', { statut: etat.statut, recherche: etat.recherche }), bandeauTaux()]);
    const recherche = el('input', { type: 'search', placeholder: 'N° de transaction, client, bénéficiaire, référence', autocomplete: 'off' });
    recherche.value = etat.recherche;
    let minuterie = null;
    recherche.addEventListener('input', () => { clearTimeout(minuterie); minuterie = setTimeout(() => { etat.recherche = recherche.value.trim(); aller('liste'); }, 450); });
    const filtres = el('div', { class: 'puces' }, ...[['EN_COURS', 'En cours'], ['', 'Toutes'], ['Paiement confirmé', 'À valider'],
      ['Validée', 'À payer'], ['Remise autorisée', 'Remises en cours'], ['Clôturée', 'Clôturées']]
      .map(([v, l]) => el('button', { type: 'button', class: 'puce', 'aria-pressed': String(etat.statut === v), onclick: () => { etat.statut = v; aller('liste'); } }, l)));

    vue.replaceChildren(
      el('div', { class: 'carte' },
        el('div', { class: 'element-titre' }, el('h1', {}, 'Transactions'),
          el('button', { type: 'button', class: 'bouton bouton-or', onclick: () => aller('nouvelle') }, '+ Nouvelle')),
        bandeau, el('label', {}, 'Rechercher', recherche), filtres),
      el('div', { class: 'carte' },
        el('p', { class: 'aide' }, liste.length + ' transaction(s)'),
        liste.length ? el('ul', { class: 'liste' }, ...liste.map((t) => el('li', {},
          el('button', { type: 'button', class: 'element element-cliquable', onclick: () => aller('fiche', t.id) },
            el('div', { class: 'element-titre' }, el('span', {}, t.numero + ' · ' + t.flux), badgeStatut(t.statut)),
            el('div', { class: 'element-detail' }, t.client + ' → ' + t.beneficiaire),
            el('div', { class: 'element-detail montant' }, M.formatCad(t.montantCadCentimes) + ' ⇄ ' + M.formatFcfa(t.montantFcfa) + ' — ' + M.formatDate(t.creeLe))))))
          : el('p', {}, 'Aucune transaction.')));
    if (etat.recherche) recherche.focus();
  }

  /* ---------- Nouvelle transaction ---------- */

  async function afficherNouvelle(vue) {
    const choix = { flux: 'A', client: null, beneficiaireId: '' };
    const bandeau = await bandeauTaux();
    const erreur = el('p', { class: 'message-erreur', role: 'alert' });
    const zoneClient = el('div');
    const zoneBenef = el('div');
    const zoneSimulation = el('div', { class: 'simulation' });
    const montant = el('input', { name: 'montantCad', inputmode: 'decimal', autocomplete: 'off', placeholder: 'ex. 500' });
    const libelleMontant = el('span', {});
    const provenance = el('input', { name: 'provenanceFonds', autocomplete: 'off', placeholder: 'ex. salaire, épargne, bourse…' });
    const motif = el('input', { name: 'motifTransfert', autocomplete: 'off', placeholder: 'ex. aide familiale, frais de scolarité…' });
    const aideProvenance = el('p', { class: 'aide' });

    const boutonsFlux = el('div', { class: 'choix-flux' }, ...['A', 'B'].map((f) => el('button', {
      type: 'button', class: 'puce puce-large', 'data-flux': f, 'aria-pressed': String(f === 'A'),
      onclick: () => { choix.flux = f; boutonsFlux.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.flux === f))); majLibelles(); simuler(); }
    }, LIBELLE_FLUX[f])));

    function majLibelles() {
      libelleMontant.textContent = choix.flux === 'A' ? 'Montant envoyé par le client (CAD, hors frais)' : 'Montant que le bénéficiaire doit recevoir au Canada (CAD)';
    }
    majLibelles();

    // --- Recherche du client ---
    const rechercheClient = el('input', { type: 'search', placeholder: 'Nom, téléphone ou n° client', autocomplete: 'off' });
    const resultats = el('ul', { class: 'liste' });
    let minuterie = null;
    rechercheClient.addEventListener('input', () => {
      clearTimeout(minuterie);
      minuterie = setTimeout(async () => {
        const q = rechercheClient.value.trim();
        if (q.length < 2) { resultats.replaceChildren(); return; }
        const l = await api('clients.lister', { recherche: q });
        resultats.replaceChildren(...l.slice(0, 8).map((c) => el('li', {}, el('button', { type: 'button', class: 'element element-cliquable', onclick: () => choisirClient(c.id) },
          el('div', { class: 'element-titre' }, el('span', {}, c.nomComplet), el('span', { class: 'badge' }, c.statut)),
          el('div', { class: 'element-detail' }, c.numeroClient + ' — ' + c.telephone)))));
      }, 350);
    });

    async function choisirClient(id) {
      const f = await api('clients.fiche', { id });
      choix.client = f;
      choix.beneficiaireId = '';
      const actifs = f.beneficiaires.filter((b) => b.actif);
      zoneClient.replaceChildren(el('div', { class: 'element' },
        el('div', { class: 'element-titre' }, el('span', {}, f.client.nomComplet + ' (' + f.client.numeroClient + ')'), el('span', { class: 'badge' }, f.client.statut)),
        f.resume.pieceExpiree ? el('p', { class: 'message-erreur' }, 'Pièce expirée : transaction impossible.') : null,
        el('button', { type: 'button', class: 'bouton bouton-discret bouton-petit', onclick: () => { choix.client = null; zoneClient.replaceChildren(rechercheLabel, resultats); zoneBenef.replaceChildren(); } }, 'Changer de client')));
      zoneBenef.replaceChildren(actifs.length
        ? el('label', {}, 'Bénéficiaire', (() => {
          const s = el('select', { name: 'beneficiaireId' }, el('option', { value: '' }, '— Choisir —'),
            ...actifs.map((b) => el('option', { value: b.id }, b.nomComplet + ' (' + b.lienClient + ') — ' + b.ville)));
          s.addEventListener('change', () => { choix.beneficiaireId = s.value; });
          return s;
        })())
        : el('p', { class: 'bandeau bandeau-orange' }, 'Ce client n\'a aucun bénéficiaire actif : ajoutez-en un depuis sa fiche (menu Clients).'));
    }
    const rechercheLabel = el('label', {}, 'Client', rechercheClient);
    zoneClient.replaceChildren(rechercheLabel, resultats);

    // --- Simulation en direct (calculée par le serveur) ---
    let minuterieSim = null;
    function simuler() {
      clearTimeout(minuterieSim);
      minuterieSim = setTimeout(async () => {
        if (!montant.value.trim()) { zoneSimulation.replaceChildren(); return; }
        try {
          const r = await api('transactions.simuler', { flux: choix.flux, montantCad: montant.value });
          const lignes = choix.flux === 'A' ? [
            ligneInfo('Taux appliqué', tauxLisible(r.tauxApplique)),
            ligneInfo('Frais', M.formatCad(r.fraisCadCentimes)),
            ligneInfo('Le client paie (Interac)', M.formatCad(r.totalClientCadCentimes)),
            ligneInfo('Le bénéficiaire reçoit à Larlé', M.formatFcfa(r.montantFcfa))
          ] : [
            ligneInfo('Taux appliqué', tauxLisible(r.tauxApplique)),
            ligneInfo('Frais', M.formatFcfa(r.fraisFcfa)),
            ligneInfo('Le client paie à Larlé', M.formatFcfa(r.totalClientFcfa)),
            ligneInfo('Le bénéficiaire reçoit au Canada', M.formatCad(r.montantCadCentimes))
          ];
          lignes.push(el('div', { class: 'ligne-info revenu' }, el('span', { class: 'aide' }, 'Revenu brut (interne)'), el('span', { class: 'montant' }, M.formatCad(r.revenuBrutCadCentimes))));
          const centimes = Math.round(parseFloat(montant.value.replace(/\s/g, '').replace(',', '.')) * 100);
          aideProvenance.textContent = centimes > r.seuilProvenanceCentimes
            ? 'Obligatoire : montant supérieur à ' + M.formatCad(r.seuilProvenanceCentimes) + '.'
            : 'Facultatif sous ' + M.formatCad(r.seuilProvenanceCentimes) + '.';
          zoneSimulation.replaceChildren(el('h2', {}, 'Calcul'), ...lignes);
        } catch (e) { zoneSimulation.replaceChildren(el('p', { class: 'message-erreur' }, e.message)); }
      }, 400);
    }
    montant.addEventListener('input', simuler);

    const form = el('form', { class: 'carte', novalidate: true },
      el('h1', {}, 'Nouvelle transaction'), bandeau,
      el('h2', {}, '1. Type'), boutonsFlux,
      el('h2', {}, '2. Client et bénéficiaire'), zoneClient, zoneBenef,
      el('h2', {}, '3. Montant'), el('label', {}, libelleMontant, montant), zoneSimulation,
      el('h2', {}, '4. Informations de conformité'), aideProvenance,
      el('label', {}, 'Provenance des fonds', provenance),
      el('label', {}, 'Motif du transfert', motif),
      erreur,
      el('div', { class: 'rangee-boutons' },
        el('button', { type: 'submit', class: 'bouton bouton-or' }, 'Créer la transaction'),
        el('button', { type: 'button', class: 'bouton bouton-discret', onclick: () => aller('liste') }, 'Annuler')));

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      erreur.textContent = '';
      if (!choix.client) { erreur.textContent = 'Choisissez un client.'; return; }
      if (!choix.beneficiaireId) { erreur.textContent = 'Choisissez un bénéficiaire.'; return; }
      try {
        const r = await M.pendant(form.querySelector('[type=submit]'), () => api('transactions.creer', {
          flux: choix.flux, clientId: choix.client.client.id, beneficiaireId: choix.beneficiaireId,
          montantCad: montant.value, provenanceFonds: provenance.value, motifTransfert: motif.value
        }));
        afficherCreation(r);
      } catch (e) { erreur.textContent = e.message; erreur.scrollIntoView({ block: 'center' }); }
    });
    vue.replaceChildren(form);
  }

  /** Après création : numéro, montants et code de retrait (affiché une seule fois). */
  function afficherCreation(r) {
    const m = r.montants;
    M.ouvrirModale(
      el('h2', {}, 'Transaction ' + r.numero + ' créée'),
      m.flux === 'A' ? ligneInfo('Le client doit payer (Interac)', M.formatCad(m.totalClientCadCentimes)) : ligneInfo('Le client doit payer à Larlé', M.formatFcfa(m.totalClientFcfa)),
      m.flux === 'A' ? ligneInfo('Le bénéficiaire recevra', M.formatFcfa(m.montantFcfa)) : ligneInfo('Le bénéficiaire recevra', M.formatCad(m.montantCadCentimes)),
      r.codeRetrait ? el('div', {},
        el('p', {}, 'Code de retrait à donner au client (il le transmet au bénéficiaire) :'),
        el('div', { class: 'secret' }, r.codeRetrait),
        el('p', { class: 'aide' }, 'Notez-le maintenant : il ne sera plus jamais affiché. Le bénéficiaire devra le donner à la boutique.')) : null,
      el('div', { class: 'rangee-boutons' },
        r.codeRetrait ? el('button', { type: 'button', class: 'bouton bouton-discret', onclick: async (ev) => {
          try { await navigator.clipboard.writeText(r.numero + ' — code de retrait : ' + r.codeRetrait); ev.target.textContent = 'Copié ✓'; } catch (e) { ev.target.textContent = 'Copie impossible'; }
        } }, 'Copier') : null,
        el('button', { type: 'button', class: 'bouton bouton-or', onclick: () => { M.fermerModale(); aller('fiche', r.id); } }, r.codeRetrait ? 'J\'ai noté le code' : 'Voir la transaction')));
  }

  /* ---------- Fiche d'une transaction ---------- */

  async function afficherFiche(vue) {
    const t = await api('transactions.fiche', { id: etat.id });
    const recharger = () => { M.fermerModale(); aller('fiche', t.id); };

    const ACTIONS = {
      confirmerPaiement: ['✔ Confirmer le paiement reçu', 'bouton-vert', () => modaleFormulaire('Confirmer le paiement du client', [
        el('p', { class: 'aide' }, t.flux === 'A'
          ? 'Vérifiez dans votre banque que le virement Interac de ' + M.formatCad(t.totalClientCadCentimes) + ' est bien arrivé.'
          : 'Vérifiez avec la boutique que ' + M.formatFcfa(t.totalClientFcfa) + ' ont bien été encaissés.'),
        champ('referencePaiement', t.flux === 'A' ? 'Référence du virement Interac' : 'Référence du reçu de la boutique', { required: true })
      ], 'Confirmer', async (d) => {
        const r = await api('transactions.confirmerPaiement', { id: t.id, referencePaiement: d.get('referencePaiement') });
        M.notifier(r.delaiHeures ? 'Paiement confirmé. Nouveau client : paiement possible dans ' + r.delaiHeures + ' h.' : 'Paiement confirmé.');
        recharger();
      }, 'bouton-vert')],

      valider: ['✔ Valider', 'bouton-vert', () => modaleFormulaire('Valider ' + t.numero, t.depasseSeuilRenforce ? [
        el('p', { class: 'bandeau bandeau-orange' }, 'Gros montant : confirmation renforcée.'),
        el('label', { class: 'case' }, el('input', { type: 'checkbox', name: 'paiementVu' }), 'J\'ai vu l\'argent du client (banque ou boutique).'),
        el('label', { class: 'case' }, el('input', { type: 'checkbox', name: 'identiteVerifiee' }), 'J\'ai vérifié l\'identité du client et du bénéficiaire.'),
        el('label', { class: 'case' }, el('input', { type: 'checkbox', name: 'montantVerifie' }), 'J\'ai vérifié le montant et le taux.'),
        champ('motDePasse', 'Votre mot de passe', { type: 'password', autocomplete: 'current-password', required: true })
      ] : [el('p', { class: 'aide' }, 'La validation réserve l\'argent dans la caisse qui paiera.')], 'Valider', async (d) => {
        await api('transactions.valider', { id: t.id, motDePasse: d.get('motDePasse') || '',
          controles: { paiementVu: d.get('paiementVu') === 'on', identiteVerifiee: d.get('identiteVerifiee') === 'on', montantVerifie: d.get('montantVerifie') === 'on' } });
        M.notifier('Transaction validée.');
        recharger();
      }, 'bouton-vert')],

      autoriserRemise: ['Autoriser la remise à Larlé', 'bouton-or', () => modaleFormulaire('Autoriser la remise', [
        el('p', { class: 'aide' }, 'Saisissez le code et le numéro de pièce que la boutique vous a transmis par WhatsApp.'),
        champ('codeRetrait', 'Code de retrait (6 chiffres)', { inputmode: 'numeric', maxlength: 6, pattern: '[0-9]{6}', required: true }),
        champ('pieceBeneficiaireNumero', 'Numéro de pièce du bénéficiaire', { required: true, autocapitalize: 'characters' })
      ], 'Vérifier et autoriser', async (d) => {
        const r = await api('transactions.autoriserRemise', { id: t.id, codeRetrait: d.get('codeRetrait'), pieceBeneficiaireNumero: d.get('pieceBeneficiaireNumero') });
        M.ouvrirModale(
          el('h2', {}, '✅ Remise autorisée'),
          el('pre', { class: 'json message-whatsapp' }, r.message),
          el('div', { class: 'rangee-boutons' },
            el('a', { class: 'bouton bouton-vert', href: r.lienWhatsApp, target: '_blank', rel: 'noopener' }, 'Envoyer à la boutique (WhatsApp)'),
            el('button', { type: 'button', class: 'bouton bouton-discret', onclick: recharger }, 'Fermer')));
      })],

      marquerPayee: [t.flux === 'A' ? 'Remise faite (photo)' : 'Virement Interac envoyé', 'bouton-vert', () => {
        const photo = champPhoto(t.flux === 'A' ? 'Photo de remise (obligatoire)' : 'Capture du virement (facultatif)');
        modaleFormulaire(t.flux === 'A' ? 'Confirmer la remise' : 'Confirmer le virement envoyé', t.flux === 'A' ? [
          el('p', { class: 'aide' }, 'Téléversez la photo envoyée par la boutique (bénéficiaire avec l\'argent).'), photo.element
        ] : [
          el('p', { class: 'aide' }, 'Envoyez ' + M.formatCad(t.montantCadCentimes) + ' par Interac à ' + (t.beneficiaire.nomComplet || '') + ', puis saisissez la référence.'),
          champ('referenceVersement', 'Référence du virement Interac envoyé', { required: true }), photo.element
        ], 'Enregistrer le paiement', async (d) => {
          await api('transactions.marquerPayee', { id: t.id, photoPreuve: photo.valeur(), referenceVersement: d.get('referenceVersement') || '' });
          M.notifier('Paiement enregistré.');
          recharger();
        }, 'bouton-vert');
      }],

      cloturer: ['Clôturer', 'bouton-discret', () => modaleFormulaire('Clôturer ' + t.numero, [el('p', { class: 'aide' }, 'La transaction est terminée. Plus aucune action ne sera possible.')],
        'Clôturer', async () => { await api('transactions.cloturer', { id: t.id }); recharger(); })],

      retirerAutorisation: ['Retirer l\'autorisation', 'bouton-discret', () => modaleFormulaire('Retirer l\'autorisation de remise', [
        el('p', { class: 'aide' }, 'Prévenez la boutique de ne rien remettre.'), champ('motif', 'Motif', { required: true })
      ], 'Retirer', async (d) => { await api('transactions.retirerAutorisation', { id: t.id, motif: d.get('motif') }); recharger(); }, 'bouton-rouge')],

      annuler: ['Annuler', 'bouton-rouge', () => modaleFormulaire('Annuler ' + t.numero, [champ('motif', 'Motif (obligatoire)', { required: true })],
        'Annuler la transaction', async (d) => { await api('transactions.annuler', { id: t.id, motif: d.get('motif') }); recharger(); }, 'bouton-rouge')],

      rembourser: ['Rembourser le client', 'bouton-rouge', () => modaleFormulaire('Rembourser le client', [
        el('p', { class: 'aide' }, 'Rendez ' + (t.flux === 'A' ? M.formatCad(t.totalClientCadCentimes) : M.formatFcfa(t.totalClientFcfa)) + ' au client, puis enregistrez-le ici.'),
        champ('motif', 'Motif (obligatoire)', { required: true }), champ('reference', 'Référence du remboursement', { required: true })
      ], 'Enregistrer le remboursement', async (d) => { await api('transactions.rembourser', { id: t.id, motif: d.get('motif'), reference: d.get('reference') }); recharger(); }, 'bouton-rouge')],

      debloquer: ['Débloquer', 'bouton-discret', () => modaleFormulaire('Débloquer ' + t.numero, [champ('motif', 'Motif (obligatoire)', { required: true })],
        'Débloquer', async (d) => { await api('transactions.debloquer', { id: t.id, motif: d.get('motif') }); recharger(); })]
    };

    const zonePreuve = el('div', { class: 'zone-photo' });
    const attente = t.payableApres && new Date().toISOString() < t.payableApres && ['Paiement confirmé', 'Validée'].includes(t.statut);

    vue.replaceChildren(
      el('button', { type: 'button', class: 'bouton bouton-discret bouton-petit lien-retour', onclick: () => aller('liste') }, '← Toutes les transactions'),
      el('div', { class: 'carte' },
        el('div', { class: 'element-titre' }, el('h1', {}, t.numero), badgeStatut(t.statut)),
        el('p', { class: 'aide' }, LIBELLE_FLUX[t.flux] + ' — créée le ' + M.formatDate(t.creeLe)),
        attente ? el('p', { class: 'bandeau bandeau-orange' }, 'Délai de sécurité (nouveau client) : paiement possible à partir du ' + M.formatDate(t.payableApres) + '.') : null,
        t.tentativesCodeEchouees ? el('p', { class: 'bandeau bandeau-orange' }, t.tentativesCodeEchouees + ' code(s) de retrait faux.') : null,
        t.motifAnnulation ? el('p', { class: 'bandeau bandeau-rouge' }, 'Motif : ' + t.motifAnnulation) : null,
        el('div', { class: 'rangee-boutons' }, ...t.actions.filter((a) => ACTIONS[a]).map((a) =>
          el('button', { type: 'button', class: 'bouton ' + ACTIONS[a][1], onclick: ACTIONS[a][2] }, ACTIONS[a][0])))),
      el('div', { class: 'carte' },
        el('h2', {}, 'Montants'),
        t.flux === 'A' ? ligneInfo('Envoyé (hors frais)', M.formatCad(t.montantCadCentimes)) : ligneInfo('Reçu au Canada', M.formatCad(t.montantCadCentimes)),
        t.flux === 'A' ? ligneInfo('Frais', M.formatCad(t.fraisCadCentimes)) : ligneInfo('Frais', M.formatFcfa(t.fraisFcfa)),
        t.flux === 'A' ? ligneInfo('Total payé par le client', M.formatCad(t.totalClientCadCentimes)) : ligneInfo('Total payé par le client', M.formatFcfa(t.totalClientFcfa)),
        t.flux === 'A' ? ligneInfo('Remis au bénéficiaire', M.formatFcfa(t.montantFcfa)) : ligneInfo('Contre-valeur', M.formatFcfa(t.montantFcfa)),
        ligneInfo('Taux appliqué (verrouillé)', tauxLisible(t.tauxApplique)),
        t.tauxReference ? ligneInfo('Taux de référence', tauxLisible(t.tauxReference)) : null,
        t.revenuBrutCadCentimes !== null && t.revenuBrutCadCentimes !== undefined ? ligneInfo('Revenu brut (figé à la validation)', M.formatCad(t.revenuBrutCadCentimes)) : null),
      el('div', { class: 'carte' },
        el('h2', {}, 'Personnes'),
        ligneInfo('Client', t.client.nomComplet + ' (' + t.client.numeroClient + ')'),
        ligneInfo('Bénéficiaire', t.beneficiaire.nomComplet + ' — ' + (t.beneficiaire.lienClient || '')),
        ligneInfo('Téléphone bénéficiaire', t.beneficiaire.telephone),
        ligneInfo('Pièce du bénéficiaire', t.pieceBeneficiaireNumero),
        ligneInfo('Provenance des fonds', t.provenanceFonds),
        ligneInfo('Motif', t.motifTransfert),
        ligneInfo('Référence paiement client', t.referencePaiement),
        t.flux === 'B' ? ligneInfo('Référence virement envoyé', t.referenceVersement) : null,
        t.aPreuve ? el('div', { class: 'rangee-boutons' }, el('button', { type: 'button', class: 'bouton bouton-discret bouton-petit', onclick: async () => {
          zonePreuve.replaceChildren(el('span', { class: 'aide' }, 'Chargement…'));
          try { const p = await api('transactions.preuve', { id: t.id }); zonePreuve.replaceChildren(el('img', { class: 'photo-piece', src: 'data:' + p.mime + ';base64,' + p.base64, alt: 'Preuve' })); } catch (e) { zonePreuve.replaceChildren(el('span', { class: 'message-erreur' }, e.message)); }
        } }, 'Voir la preuve')) : null, zonePreuve),
      el('div', { class: 'carte' },
        el('h2', {}, 'Historique'),
        el('ol', { class: 'chronologie' }, ...t.historique.map((h) => el('li', {},
          el('div', {}, badgeStatut(h.vers)), el('div', { class: 'element-detail' }, M.formatDate(h.dateUTC) + (h.commentaire ? ' — ' + h.commentaire : '')))))));
  }

  M.ajouterVue('transactions', {
    ordre: 15, titre: 'Transactions', roles: ['ADMIN'],
    auMenu: () => { etat.mode = 'liste'; },
    afficher: (vue) => etat.mode === 'fiche' && etat.id ? afficherFiche(vue) : etat.mode === 'nouvelle' ? afficherNouvelle(vue) : afficherListe(vue)
  });

  /* ================================================================
   * ÉCRAN TAUX
   * ================================================================ */

  /** Petit graphique (une seule courbe : le taux de référence), avec info-bulle au survol. */
  function graphiqueTaux(historique) {
    const points = historique.slice().reverse().map((h) => ({ date: h.dateUTC, v: parseFloat(h.tauxReference) }));
    if (points.length < 2) return el('p', { class: 'aide' }, 'Le graphique apparaîtra après deux saisies de taux.');
    const L = 360, H = 200, g = 42, d = 8, h = 12, b = 26; // dimensions pensées pour un téléphone
    const min = Math.min(...points.map((p) => p.v)), max = Math.max(...points.map((p) => p.v));
    const marge = (max - min) * 0.1 || 1;
    const y = (v) => h + (H - h - b) * (1 - (v - (min - marge)) / (max - min + 2 * marge));
    const x = (i) => g + (L - g - d) * i / (points.length - 1);
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + L + ' ' + H);
    svg.setAttribute('class', 'graphique');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Évolution du taux de référence');
    const ajouter = (tag, attrs, texte) => {
      const n = document.createElementNS(NS, tag);
      Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
      if (texte !== undefined) n.textContent = texte;
      svg.appendChild(n);
      return n;
    };
    [min - marge, (min + max) / 2, max + marge].forEach((v) => {
      ajouter('line', { x1: g, x2: L - d, y1: y(v), y2: y(v), class: 'grille' });
      ajouter('text', { x: g - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'axe' }, v.toFixed(1).replace('.', ','));
    });
    const court = (iso) => new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit' }).format(new Date(iso));
    ajouter('text', { x: g, y: H - 8, class: 'axe' }, court(points[0].date));
    ajouter('text', { x: L - d, y: H - 8, 'text-anchor': 'end', class: 'axe' }, court(points[points.length - 1].date));
    ajouter('path', { d: points.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.v).toFixed(1)).join(' '), class: 'courbe' });
    const repere = ajouter('line', { y1: h, y2: H - b, class: 'repere', visibility: 'hidden' });
    const point = ajouter('circle', { r: 5, class: 'point', visibility: 'hidden' });
    const bulle = el('div', { class: 'bulle', hidden: true });
    const zone = el('div', { class: 'zone-graphique' }, svg, bulle);
    svg.addEventListener('pointermove', (ev) => {
      const r = svg.getBoundingClientRect();
      const px = (ev.clientX - r.left) * L / r.width;
      const i = Math.max(0, Math.min(points.length - 1, Math.round((px - g) / (L - g - d) * (points.length - 1))));
      const p = points[i];
      [repere, point].forEach((n) => n.setAttribute('visibility', 'visible'));
      repere.setAttribute('x1', x(i)); repere.setAttribute('x2', x(i));
      point.setAttribute('cx', x(i)); point.setAttribute('cy', y(p.v));
      bulle.hidden = false;
      bulle.textContent = M.formatDate(p.date) + ' — ' + tauxLisible(String(p.v));
      bulle.style.left = Math.min(r.width - 170, Math.max(0, x(i) * r.width / L - 80)) + 'px';
    });
    svg.addEventListener('pointerleave', () => { [repere, point].forEach((n) => n.setAttribute('visibility', 'hidden')); bulle.hidden = true; });
    return zone;
  }

  async function vueTaux(vue) {
    const e = await api('taux.etat', { limite: 120 });
    const erreur = el('p', { class: 'message-erreur', role: 'alert' });
    const apercu = el('div', { class: 'simulation' });
    const reference = el('input', { name: 'tauxReference', inputmode: 'decimal', autocomplete: 'off', placeholder: 'ex. 440,50', required: true });
    let minuterie = null;
    reference.addEventListener('input', () => {
      clearTimeout(minuterie);
      minuterie = setTimeout(async () => {
        if (!reference.value.trim()) { apercu.replaceChildren(); return; }
        try {
          const a = await api('taux.apercu', { tauxReference: reference.value });
          apercu.replaceChildren(ligneInfo('Taux A (le bénéficiaire reçoit par CAD)', tauxLisible(a.tauxFluxA)), ligneInfo('Taux B (prix d\'un CAD)', tauxLisible(a.tauxFluxB)));
        } catch (err) { apercu.replaceChildren(el('p', { class: 'message-erreur' }, err.message)); }
      }, 350);
    });
    const form = el('form', { class: 'carte', novalidate: true },
      el('h2', {}, 'Saisir le taux du jour'),
      el('label', {}, 'Taux de référence du marché (FCFA pour 1 CAD)', reference), apercu,
      el('label', {}, 'Commentaire (facultatif, ex. source du taux)', el('input', { name: 'commentaire', autocomplete: 'off' })),
      erreur, el('button', { type: 'submit', class: 'bouton bouton-or' }, 'Enregistrer le taux'));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      erreur.textContent = '';
      const d = { tauxReference: reference.value, commentaire: new FormData(form).get('commentaire') };
      try {
        await M.pendant(form.querySelector('[type=submit]'), () => api('taux.saisir', d));
        M.notifier('Taux enregistré.'); M.ouvrirVue('taux');
      } catch (err) {
        if (err.code === 'TAUX_ECART' && confirm(err.message + '\n\nConfirmer ce taux ?')) {
          try { await api('taux.saisir', Object.assign(d, { confirmerEcart: true })); M.notifier('Taux enregistré.'); M.ouvrirVue('taux'); } catch (e2) { erreur.textContent = e2.message; }
        } else erreur.textContent = err.message;
      }
    });

    const a = e.actuel;
    vue.replaceChildren(
      el('div', { class: 'carte' },
        el('h1', {}, 'Taux de change'),
        !a ? el('p', { class: 'bandeau bandeau-rouge' }, 'Aucun taux saisi : aucune transaction possible.') :
          el('div', {},
            a.perime ? el('p', { class: 'bandeau bandeau-rouge' }, 'Taux de plus de ' + e.validiteHeures + ' h : création de transactions bloquée.') : null,
            el('div', { class: 'tuiles' },
              el('div', { class: 'tuile' }, el('div', { class: 'aide' }, 'Référence'), el('div', { class: 'tuile-valeur' }, tauxLisible(a.tauxReference))),
              el('div', { class: 'tuile' }, el('div', { class: 'aide' }, 'Flux A (envoi)'), el('div', { class: 'tuile-valeur' }, tauxLisible(a.tauxFluxA))),
              el('div', { class: 'tuile' }, el('div', { class: 'aide' }, 'Flux B (achat CAD)'), el('div', { class: 'tuile-valeur' }, tauxLisible(a.tauxFluxB))),
              el('div', { class: 'tuile' }, el('div', { class: 'aide' }, 'Saisi le'), el('div', { class: 'tuile-valeur petit' }, M.formatDate(a.dateUTC))))),
        el('p', { class: 'aide' }, 'Les marges se règlent dans Paramètres (MARGE_A_*, MARGE_B_*).')),
      form,
      el('div', { class: 'carte' }, el('h2', {}, 'Évolution du taux de référence'), graphiqueTaux(e.historique),
        el('details', {}, el('summary', { class: 'aide' }, 'Voir le tableau'),
          el('ul', { class: 'liste' }, ...e.historique.map((h) => el('li', { class: 'element' },
            el('div', { class: 'element-titre' }, el('span', { class: 'montant' }, tauxLisible(h.tauxReference)), el('span', { class: 'element-detail' }, M.formatDate(h.dateUTC))),
            el('div', { class: 'element-detail' }, 'A ' + tauxLisible(h.tauxFluxA) + ' — B ' + tauxLisible(h.tauxFluxB) + (h.commentaire ? ' — ' + h.commentaire : ''))))))));
  }

  M.ajouterVue('taux', { ordre: 40, titre: 'Taux', roles: ['ADMIN'], afficher: vueTaux });

  /* ================================================================
   * ÉCRAN CAISSES
   * ================================================================ */

  let deviseMouvements = 'CAD';

  async function vueCaisses(vue) {
    const [e, mouvements] = await Promise.all([api('caisses.etat'), api('caisses.mouvements', { devise: deviseMouvements })]);
    const carteCaisse = (titre, reel, promis, dispo, min, max, format) => {
      const niveau = dispo < min ? ['badge-rouge', 'Sous le minimum'] : (reel > max ? ['badge-orange', 'Au-dessus du maximum'] : ['badge-vert', 'Normal']);
      return el('div', { class: 'carte' },
        el('div', { class: 'element-titre' }, el('h2', {}, titre), el('span', { class: 'badge ' + niveau[0] }, niveau[1])),
        el('div', { class: 'tuiles tuiles-3' },
          el('div', { class: 'tuile' }, el('div', { class: 'aide' }, 'Solde réel'), el('div', { class: 'tuile-valeur montant' }, format(reel))),
          el('div', { class: 'tuile' }, el('div', { class: 'aide' }, 'Promis (validé, pas encore payé)'), el('div', { class: 'tuile-valeur montant' }, format(promis))),
          el('div', { class: 'tuile' }, el('div', { class: 'aide' }, 'Disponible'), el('div', { class: 'tuile-valeur montant' }, format(dispo)))),
        el('p', { class: 'aide' }, 'Seuils : minimum ' + format(min) + ', maximum ' + format(max) + '.'));
    };

    const erreur = el('p', { class: 'message-erreur', role: 'alert' });
    const form = el('form', { class: 'carte', novalidate: true },
      el('h2', {}, 'Apport ou retrait de fonds de roulement'),
      el('p', { class: 'aide' }, 'Votre propre argent mis dans une caisse (ou retiré), séparé des transactions clients.'),
      el('div', { class: 'grille-formulaire' },
        el('label', {}, 'Caisse', el('select', { name: 'devise' }, el('option', { value: 'CAD' }, 'CAD (Canada)'), el('option', { value: 'FCFA' }, 'FCFA (Larlé)'))),
        el('label', {}, 'Opération', el('select', { name: 'type' }, el('option', { value: 'APPORT' }, 'Apport'), el('option', { value: 'RETRAIT' }, 'Retrait'))),
        champ('montant', 'Montant', { inputmode: 'decimal', required: true }),
        champ('reference', 'Référence (facultatif)')),
      champ('commentaire', 'Commentaire (obligatoire)', { required: true }),
      erreur, el('button', { type: 'submit', class: 'bouton bouton-or' }, 'Enregistrer'));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      erreur.textContent = '';
      try {
        await M.pendant(form.querySelector('[type=submit]'), () => api('caisses.fondsRoulement', Object.fromEntries(new FormData(form))));
        M.notifier('Mouvement enregistré.'); M.ouvrirVue('caisses');
      } catch (err) { erreur.textContent = err.message; }
    });

    const format = deviseMouvements === 'CAD' ? M.formatCad : M.formatFcfa;
    vue.replaceChildren(
      el('div', { class: 'carte' }, el('h1', {}, 'Caisses'),
        el('p', { class: 'aide' }, 'Le solde est calculé à partir des mouvements : il ne se modifie jamais à la main. ',
          'Rapprochement quotidien, équilibre et rééquilibrage : phase 4.')),
      carteCaisse('Caisse CAD (Canada)', e.cad.reelCentimes, e.cad.promisCentimes, e.cad.disponibleCentimes, e.cad.minCentimes, e.cad.maxCentimes, M.formatCad),
      carteCaisse('Caisse FCFA (Larlé)', e.fcfa.reel, e.fcfa.promis, e.fcfa.disponible, e.fcfa.min, e.fcfa.max, M.formatFcfa),
      form,
      el('div', { class: 'carte' },
        el('div', { class: 'element-titre' }, el('h2', {}, 'Derniers mouvements'),
          el('div', { class: 'puces' }, ...['CAD', 'FCFA'].map((dv) => el('button', { type: 'button', class: 'puce', 'aria-pressed': String(dv === deviseMouvements), onclick: () => { deviseMouvements = dv; M.ouvrirVue('caisses'); } }, dv)))),
        mouvements.length ? el('ul', { class: 'liste' }, ...mouvements.map((m) => el('li', { class: 'element' },
          el('div', { class: 'element-titre' }, el('span', {}, m.libelle), el('span', { class: 'montant ' + (m.montant < 0 ? 'negatif' : 'positif') }, (m.montant > 0 ? '+' : '') + format(m.montant))),
          el('div', { class: 'element-detail' }, M.formatDate(m.dateUTC) + (m.commentaire ? ' — ' + m.commentaire : '') + (m.reference ? ' — réf. ' + m.reference : '')))))
          : el('p', { class: 'aide' }, 'Aucun mouvement.')));
  }

  M.ajouterVue('caisses', { ordre: 30, titre: 'Caisses', roles: ['ADMIN'], afficher: vueCaisses });
})();
