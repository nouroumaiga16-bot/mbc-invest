/**
 * MBC Transfert — Logique du site
 * --------------------------------
 * Le site ne contient AUCUN secret et ne décide de rien d'important :
 * il affiche des écrans et transmet les demandes au serveur (Apps Script),
 * qui vérifie tout (identité, rôle, règles). Masquer un bouton ici n'est
 * qu'un confort d'affichage, jamais une protection.
 */
(function () {
  'use strict';

  const API_URL = (window.MBT_CONFIG && window.MBT_CONFIG.API_URL) || '';
  const CLE_JETON = 'mbt_jeton';

  const etat = {
    jeton: null,
    utilisateur: null,
    expireLe: null,
    vueActive: 'accueil'
  };

  /* ================================================================
   * OUTILS D'AFFICHAGE
   * ================================================================ */

  /** Raccourci de sélection. */
  const $ = (sel, racine) => (racine || document).querySelector(sel);

  /**
   * Crée un élément HTML de façon sûre (le texte est toujours inséré comme
   * du texte, jamais comme du code : protection contre l'injection).
   * el('button', { class: 'bouton', onclick: fn }, 'Texte', autreElement)
   */
  function el(tag, attributs, ...enfants) {
    const n = document.createElement(tag);
    Object.entries(attributs || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (k === 'class') n.className = v;
      else if (v === true) n.setAttribute(k, '');
      else n.setAttribute(k, String(v));
    });
    enfants.flat().forEach((e) => {
      if (e === null || e === undefined || e === false) return;
      n.append(e instanceof Node ? e : document.createTextNode(String(e)));
    });
    return n;
  }

  /* ---------- Formats français (montants toujours avec la devise) ---------- */

  const formatEntierFr = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

  /** 125050 (centimes) → « 1 250,50 CAD ». Calcul en entiers, sans virgule flottante. */
  function formatCad(centimes) {
    const n = Math.round(Number(centimes) || 0);
    const signe = n < 0 ? '−' : '';
    const abs = Math.abs(n);
    return signe + formatEntierFr.format(Math.floor(abs / 100)) + ',' + String(abs % 100).padStart(2, '0') + '\u00a0CAD';
  }

  /** 512500 → « 512 500 FCFA ». */
  function formatFcfa(montant) {
    const n = Math.round(Number(montant) || 0);
    return (n < 0 ? '−' : '') + formatEntierFr.format(Math.abs(n)) + '\u00a0FCFA';
  }

  /** « 1250.50 » (texte de stockage) → « 1 250,50 CAD ». */
  function formatCadTexte(texte) {
    const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(texte).trim());
    if (!m) return String(texte);
    const centimes = parseInt(m[2], 10) * 100 + parseInt(((m[3] || '') + '00').slice(0, 2), 10);
    return formatCad(m[1] ? -centimes : centimes);
  }

  /** Date ISO UTC → date et heure lisibles dans le fuseau de l'utilisateur. */
  function formatDate(iso, fuseau) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return new Intl.DateTimeFormat('fr-FR', {
      timeZone: fuseau || (etat.utilisateur && etat.utilisateur.fuseau) || 'America/Toronto',
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    }).format(d);
  }

  function heureDans(fuseau) {
    return new Intl.DateTimeFormat('fr-FR', { timeZone: fuseau, hour: '2-digit', minute: '2-digit' }).format(new Date());
  }

  const NOMS_FUSEAUX = {
    'America/Toronto': 'Montréal',
    'Africa/Ouagadougou': 'Ouagadougou'
  };

  /** Affiche une notification en bas de l'écran. */
  let minuterieNotif = null;
  function notifier(message, estErreur) {
    const n = $('#notification');
    n.textContent = message;
    n.classList.toggle('erreur', !!estErreur);
    n.hidden = false;
    clearTimeout(minuterieNotif);
    minuterieNotif = setTimeout(() => { n.hidden = true; }, estErreur ? 6000 : 3500);
  }

  /* ---------- Fenêtre modale ---------- */

  function ouvrirModale(...contenu) {
    const c = $('#modale-contenu');
    c.replaceChildren(...contenu);
    const d = $('#modale');
    if (!d.open) d.showModal();
  }
  function fermerModale() {
    const d = $('#modale');
    if (d.open) d.close();
    $('#modale-contenu').replaceChildren();
  }

  /* ================================================================
   * COMMUNICATION AVEC LE SERVEUR
   * ================================================================ */

  class ErreurApi extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }

  /**
   * Envoie une demande au serveur.
   * (Type « text/plain » : c'est ce qu'accepte Apps Script sans blocage du navigateur.)
   */
  async function api(action, donnees) {
    if (!API_URL || API_URL.indexOf('https://') !== 0) {
      throw new ErreurApi('CONFIG', 'Adresse du serveur non configurée (assets/config.js).');
    }
    let reponse;
    try {
      const r = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, jeton: etat.jeton, donnees: donnees || {} }),
        redirect: 'follow',
        cache: 'no-store'
      });
      reponse = await r.json();
    } catch (e) {
      throw new ErreurApi('RESEAU', 'Connexion au serveur impossible. Vérifiez Internet et réessayez.');
    }
    if (!reponse.ok) {
      if (reponse.code === 'SESSION_INVALIDE') {
        oublierSession();
        afficherEcran('connexion');
      } else if (reponse.code === 'MDP_A_CHANGER') {
        afficherEcran('mdp');
      }
      throw new ErreurApi(reponse.code, reponse.message);
    }
    return reponse.donnees;
  }

  /** Désactive un bouton pendant une demande pour éviter les doubles clics. */
  async function pendant(bouton, fonction) {
    const texte = bouton ? bouton.textContent : '';
    if (bouton) { bouton.disabled = true; bouton.textContent = 'Patientez…'; }
    try { return await fonction(); } finally {
      if (bouton) { bouton.disabled = false; bouton.textContent = texte; }
    }
  }

  /* ================================================================
   * SESSION ET ÉCRANS
   * ================================================================ */

  function memoriserSession(jeton) {
    etat.jeton = jeton;
    try { localStorage.setItem(CLE_JETON, jeton); } catch (e) { /* stockage indisponible : session limitée à l'onglet */ }
  }

  function oublierSession() {
    etat.jeton = null; etat.utilisateur = null; etat.expireLe = null;
    try { localStorage.removeItem(CLE_JETON); } catch (e) { /* rien */ }
  }

  function afficherEcran(nom) {
    $('#ecran-connexion').hidden = nom !== 'connexion';
    $('#ecran-mdp').hidden = nom !== 'mdp';
    $('#ecran-app').hidden = nom !== 'app';
    const focus = { connexion: '#form-connexion input', mdp: '#form-mdp input' }[nom];
    if (focus) setTimeout(() => { const i = $(focus); if (i) i.focus(); }, 50);
  }

  async function deconnexion() {
    try { if (etat.jeton) await api('auth.deconnexion'); } catch (e) { /* on déconnecte quand même */ }
    oublierSession();
    fermerModale();
    afficherEcran('connexion');
  }

  /** Après connexion ou au chargement : décide quel écran montrer. */
  function entrerDansApp(utilisateur, expireLe) {
    etat.utilisateur = utilisateur;
    etat.expireLe = expireLe;
    if (utilisateur.doitChangerMdp) { afficherEcran('mdp'); return; }
    $('#nom-utilisateur').textContent = utilisateur.nomComplet;
    $('#role-utilisateur').textContent = utilisateur.libelleRole;
    construireMenu();
    afficherEcran('app');
    ouvrirVue('accueil');
  }

  /* ================================================================
   * MENU — les entrées dépendent du rôle (le serveur vérifie de son côté)
   * ================================================================ */

  // « ordre » fixe la position dans le menu (les modules des phases suivantes s'insèrent entre les deux).
  const VUES = {
    accueil: { ordre: 10, titre: 'Accueil', roles: ['ADMIN', 'AGENT_OUAGA', 'AGENT_CANADA'], afficher: vueAccueil },
    parametres: { ordre: 900, titre: 'Paramètres', roles: ['ADMIN'], afficher: vueParametres },
    utilisateurs: { ordre: 910, titre: 'Utilisateurs', roles: ['ADMIN'], afficher: vueUtilisateurs },
    journal: { ordre: 920, titre: 'Journal d\'audit', roles: ['ADMIN'], afficher: vueJournal }
  };

  function construireMenu() {
    const menu = $('#menu');
    menu.replaceChildren(...Object.entries(VUES)
      .sort(([, a], [, b]) => a.ordre - b.ordre)
      .filter(([, v]) => v.roles.includes(etat.utilisateur.role))
      .map(([cle, v]) => el('button', { type: 'button', 'data-vue': cle, onclick: () => {
        if (v.auMenu) v.auMenu(); // ex. revenir à la liste des clients
        ouvrirVue(cle);
      } }, v.titre)));
  }

  async function ouvrirVue(cle) {
    const def = VUES[cle];
    if (!def || !def.roles.includes(etat.utilisateur.role)) return;
    etat.vueActive = cle;
    document.querySelectorAll('#menu button').forEach((b) => {
      if (b.dataset.vue === cle) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    const vue = $('#vue');
    vue.replaceChildren(el('p', { class: 'chargement' }, 'Chargement…'));
    try {
      await def.afficher(vue);
    } catch (e) {
      if (e.code !== 'SESSION_INVALIDE') {
        vue.replaceChildren(el('div', { class: 'carte' }, el('p', { class: 'message-erreur' }, e.message)));
      }
    }
  }

  /* ================================================================
   * VUE : ACCUEIL
   * ================================================================ */

  let minuterieHorloge = null;

  async function vueAccueil(vue) {
    const u = etat.utilisateur;
    const horloges = el('div', { class: 'horloges' });
    const majHorloges = () => horloges.replaceChildren(
      ...['America/Toronto', 'Africa/Ouagadougou'].map((f) =>
        el('div', { class: 'horloge' }, el('div', { class: 'heure' }, heureDans(f)), el('div', { class: 'lieu' }, NOMS_FUSEAUX[f]))));
    majHorloges();
    clearInterval(minuterieHorloge);
    minuterieHorloge = setInterval(majHorloges, 30000);

    const blocs = [
      el('div', { class: 'carte' },
        el('h1', {}, 'Bonjour ' + u.nomComplet),
        el('p', { class: 'aide' }, 'Connecté en tant que ', el('strong', {}, u.libelleRole),
          '. Session valable jusqu\'au ', formatDate(etat.expireLe), '.'),
        horloges)
    ];

    // Informations de la boutique (paramètres visibles par tous).
    const params = await api('parametres.lister');
    const p = Object.fromEntries(params.map((x) => [x.cle, x.valeur]));
    blocs.push(el('div', { class: 'carte' },
      el('h2', {}, p.BOUTIQUE_NOM || 'Boutique'),
      el('p', {}, p.BOUTIQUE_ADRESSE || ''),
      el('p', { class: 'aide' }, (p.BOUTIQUE_HORAIRES || '') + ' — ' + (p.BOUTIQUE_TELEPHONE || ''))));

    if (u.role === 'ADMIN') {
      blocs.push(el('div', { class: 'carte' },
        el('h2', {}, 'Avancement du projet'),
        el('ul', { class: 'liste' },
          ...[
            ['Phase 1 — Connexion, rôles, paramètres, journal d\'audit', true],
            ['Phase 2 — Clients, bénéficiaires, KYC', true],
            ['Phase 3 — Taux et transactions', true],
            ['Phase 4 — Caisses, équilibre, rapprochement', false],
            ['Phase 5 — Flux internes du groupe', false],
            ['Phase 6 — Rentabilité et tableau de bord', false],
            ['Phase 7 — Conformité', false],
            ['Phase 8 — WhatsApp, reçus, design', false],
            ['Phase 9 — Tests', false]
          ].map(([t, fait]) => el('li', { class: 'element' },
            el('div', { class: 'element-titre' }, t,
              el('span', { class: 'badge ' + (fait ? 'badge-vert' : '') }, fait ? 'Disponible' : 'À venir')))))));
    } else {
      blocs.push(el('div', { class: 'carte' },
        el('h2', {}, 'Vos outils'),
        el('p', { class: 'aide' }, 'Menu « Clients » : créer une fiche client, ajouter ses bénéficiaires et les photos de sa pièce. ',
          'Les encaissements et paiements arriveront dans les prochaines étapes.')));
    }
    vue.replaceChildren(...blocs);
  }

  /* ================================================================
   * VUE : PARAMÈTRES (Admin)
   * ================================================================ */

  /** Affichage lisible d'une valeur de paramètre selon son type. */
  function valeurLisible(p) {
    if (p.type === 'cad') return formatCadTexte(p.valeur);
    if (p.type === 'fcfa') return formatFcfa(p.valeur);
    if (p.type === 'json') {
      try { return JSON.stringify(JSON.parse(p.valeur), null, 1); } catch (e) { return p.valeur; }
    }
    return p.valeur;
  }

  async function vueParametres(vue) {
    const params = await api('parametres.lister');
    const categories = {};
    params.forEach((p) => { (categories[p.categorie] = categories[p.categorie] || []).push(p); });

    vue.replaceChildren(
      el('div', { class: 'carte' },
        el('h1', {}, 'Paramètres'),
        el('p', { class: 'aide' },
          'Tous les seuils sont modifiables. Chaque modification exige une justification et est inscrite au journal d\'audit. ',
          'Les seuils de conformité sont à faire confirmer par votre conseiller.')),
      ...Object.entries(categories).map(([cat, liste]) =>
        el('section', { class: 'carte' },
          el('h2', {}, cat),
          el('ul', { class: 'liste' }, ...liste.map((p) =>
            el('li', { class: 'element' },
              el('div', { class: 'element-titre' },
                el('span', {}, p.cle),
                el('button', { type: 'button', class: 'bouton bouton-discret bouton-petit', onclick: () => modaleParametre(p) }, 'Modifier')),
              el('div', { class: p.type === 'json' ? '' : 'valeur-param' },
                p.type === 'json' ? el('pre', { class: 'json' }, valeurLisible(p)) : valeurLisible(p)),
              el('div', { class: 'element-detail' }, p.description),
              p.modifieLe ? el('div', { class: 'element-detail' }, 'Dernière modification : ' + formatDate(p.modifieLe)) : null))))));
  }

  function champPourType(p) {
    if (p.type.startsWith('choix:')) {
      return el('select', { name: 'valeur' }, ...p.type.slice(6).split('|').map((c) =>
        el('option', { value: c, selected: c === p.valeur }, c)));
    }
    if (p.type === 'booleen') {
      return el('select', { name: 'valeur' }, ...['OUI', 'NON'].map((c) => el('option', { value: c, selected: c === p.valeur }, c)));
    }
    if (p.type === 'json') {
      let joli = p.valeur;
      try { joli = JSON.stringify(JSON.parse(p.valeur), null, 2); } catch (e) { /* tel quel */ }
      const t = el('textarea', { name: 'valeur', rows: 8, spellcheck: 'false' });
      t.value = joli;
      return t;
    }
    const numerique = ['entier', 'decimal', 'cad', 'fcfa'].includes(p.type);
    const i = el('input', { name: 'valeur', inputmode: numerique ? 'decimal' : null, autocomplete: 'off' });
    i.value = p.type === 'cad' ? String(p.valeur).replace('.', ',') : p.valeur;
    return i;
  }

  function modaleParametre(p) {
    const unite = { cad: ' (en CAD, ex. 1 000,00)', fcfa: ' (en FCFA, nombre entier)', entier: ' (nombre entier)', decimal: ' (nombre, ex. 2,5)' }[p.type] || '';
    const erreur = el('p', { class: 'message-erreur', role: 'alert' });
    const form = el('form', {},
      el('h2', {}, 'Modifier ' + p.cle),
      el('p', { class: 'aide' }, p.description),
      el('label', {}, 'Nouvelle valeur' + unite, champPourType(p)),
      el('label', {}, 'Justification (obligatoire, inscrite au journal)',
        el('input', { name: 'justification', required: true, maxlength: 500, autocomplete: 'off' })),
      erreur,
      el('div', { class: 'rangee-boutons' },
        el('button', { type: 'submit', class: 'bouton bouton-or' }, 'Enregistrer'),
        el('button', { type: 'button', class: 'bouton bouton-discret', onclick: fermerModale }, 'Annuler')));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      erreur.textContent = '';
      const f = new FormData(form);
      try {
        const r = await pendant(form.querySelector('[type=submit]'), () => api('parametres.modifier', {
          cle: p.cle, valeur: f.get('valeur'), justification: f.get('justification')
        }));
        fermerModale();
        notifier(r.inchange ? 'Aucun changement.' : 'Paramètre enregistré.');
        ouvrirVue('parametres');
      } catch (e) { erreur.textContent = e.message; }
    });
    ouvrirModale(form);
  }

  /* ================================================================
   * VUE : UTILISATEURS (Admin)
   * ================================================================ */

  const ROLES = { ADMIN: 'Administrateur', AGENT_OUAGA: 'Agent Ouaga', AGENT_CANADA: 'Agent Canada' };

  function selectRole(valeur) {
    return el('select', { name: 'role' }, ...Object.entries(ROLES).map(([k, v]) => el('option', { value: k, selected: k === valeur }, v)));
  }
  function selectFuseau(valeur) {
    return el('select', { name: 'fuseau' }, ...Object.entries(NOMS_FUSEAUX).map(([k, v]) => el('option', { value: k, selected: k === valeur }, 'Heure de ' + v)));
  }

  /** Affiche un mot de passe temporaire UNE seule fois. */
  function afficherMdpTemporaire(titre, identifiant, mdp) {
    ouvrirModale(
      el('h2', {}, titre),
      el('p', {}, 'Identifiant : ', el('strong', {}, identifiant)),
      el('p', {}, 'Mot de passe temporaire :'),
      el('div', { class: 'secret' }, mdp),
      el('p', { class: 'aide' }, 'Transmettez-le à la personne en main propre ou par appel (pas par écrit si possible). ',
        'Il ne sera plus jamais affiché. Elle devra le changer à sa première connexion.'),
      el('div', { class: 'rangee-boutons' },
        el('button', { type: 'button', class: 'bouton bouton-discret', onclick: async (ev) => {
          try { await navigator.clipboard.writeText(mdp); ev.target.textContent = 'Copié ✓'; } catch (e) { ev.target.textContent = 'Copie impossible'; }
        } }, 'Copier'),
        el('button', { type: 'button', class: 'bouton bouton-or', onclick: fermerModale }, 'J\'ai noté le mot de passe')));
  }

  async function vueUtilisateurs(vue) {
    const liste = await api('utilisateurs.lister');
    const maintenant = new Date().toISOString();

    const erreur = el('p', { class: 'message-erreur', role: 'alert' });
    const form = el('form', { class: 'carte' },
      el('h2', {}, 'Nouvel utilisateur'),
      el('div', { class: 'grille-formulaire' },
        el('label', {}, 'Identifiant (ex. awa.larle)', el('input', { name: 'identifiant', required: true, autocapitalize: 'none', spellcheck: 'false', autocomplete: 'off' })),
        el('label', {}, 'Nom complet', el('input', { name: 'nomComplet', required: true, autocomplete: 'off' })),
        el('label', {}, 'Rôle', selectRole('AGENT_OUAGA')),
        el('label', {}, 'Fuseau horaire', selectFuseau('Africa/Ouagadougou'))),
      erreur,
      el('button', { type: 'submit', class: 'bouton bouton-or' }, 'Créer le compte'));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      erreur.textContent = '';
      const f = new FormData(form);
      try {
        const r = await pendant(form.querySelector('[type=submit]'), () => api('utilisateurs.creer', Object.fromEntries(f)));
        await ouvrirVue('utilisateurs');
        afficherMdpTemporaire('Compte créé', r.identifiant, r.motDePasseTemporaire);
      } catch (e) { erreur.textContent = e.message; }
    });

    const action = async (bouton, nomAction, donnees, messageOk) => {
      try {
        const r = await pendant(bouton, () => api(nomAction, donnees));
        await ouvrirVue('utilisateurs');
        if (r && r.motDePasseTemporaire) afficherMdpTemporaire('Mot de passe réinitialisé', r.identifiant, r.motDePasseTemporaire);
        else notifier(messageOk);
      } catch (e) { notifier(e.message, true); }
    };

    const cartes = liste.map((u) => {
      const bloque = u.bloqueJusqua && u.bloqueJusqua > maintenant;
      return el('li', { class: 'element' },
        el('div', { class: 'element-titre' },
          el('span', {}, u.nomComplet),
          el('span', {},
            el('span', { class: 'badge' }, u.libelleRole), ' ',
            el('span', { class: 'badge ' + (u.actif ? 'badge-vert' : 'badge-rouge') }, u.actif ? 'Actif' : 'Désactivé'),
            bloque ? el('span', { class: 'badge badge-orange' }, ' Bloqué') : null)),
        el('div', { class: 'element-detail' }, 'Identifiant : ' + u.identifiant + ' — Heure de ' + (NOMS_FUSEAUX[u.fuseau] || u.fuseau)),
        el('div', { class: 'element-detail' }, 'Dernière connexion : ' + formatDate(u.derniereConnexion) +
          (u.doitChangerMdp ? ' — doit changer son mot de passe' : '')),
        el('div', { class: 'rangee-boutons' },
          el('button', { type: 'button', class: 'bouton bouton-discret bouton-petit', onclick: () => modaleModifierUtilisateur(u) }, 'Modifier'),
          el('button', { type: 'button', class: 'bouton bouton-discret bouton-petit', onclick: (ev) => {
            if (confirm('Générer un nouveau mot de passe temporaire pour ' + u.nomComplet + ' ? Ses sessions ouvertes seront fermées.')) {
              action(ev.currentTarget, 'utilisateurs.reinitialiserMdp', { id: u.id });
            }
          } }, 'Réinitialiser le mot de passe'),
          bloque ? el('button', { type: 'button', class: 'bouton bouton-discret bouton-petit', onclick: (ev) =>
            action(ev.currentTarget, 'utilisateurs.modifier', { id: u.id, debloquer: true }, 'Compte débloqué.') }, 'Débloquer') : null,
          el('button', { type: 'button', class: 'bouton bouton-petit ' + (u.actif ? 'bouton-rouge' : 'bouton-vert'), onclick: (ev) => {
            if (confirm((u.actif ? 'Désactiver' : 'Réactiver') + ' le compte de ' + u.nomComplet + ' ?')) {
              action(ev.currentTarget, 'utilisateurs.modifier', { id: u.id, actif: !u.actif }, u.actif ? 'Compte désactivé.' : 'Compte réactivé.');
            }
          } }, u.actif ? 'Désactiver' : 'Réactiver')));
    });

    vue.replaceChildren(
      el('div', { class: 'carte' },
        el('h1', {}, 'Utilisateurs'),
        el('p', { class: 'aide' }, 'Un compte n\'est jamais supprimé : on le désactive, pour garder la trace de ses actions.'),
        el('ul', { class: 'liste' }, ...cartes)),
      form);
  }

  function modaleModifierUtilisateur(u) {
    const erreur = el('p', { class: 'message-erreur', role: 'alert' });
    const nom = el('input', { name: 'nomComplet', required: true });
    nom.value = u.nomComplet;
    const form = el('form', {},
      el('h2', {}, 'Modifier ' + u.identifiant),
      el('label', {}, 'Nom complet', nom),
      el('label', {}, 'Rôle', selectRole(u.role)),
      el('label', {}, 'Fuseau horaire', selectFuseau(u.fuseau)),
      el('p', { class: 'aide' }, 'Changer le rôle ferme immédiatement les sessions ouvertes de cette personne.'),
      erreur,
      el('div', { class: 'rangee-boutons' },
        el('button', { type: 'submit', class: 'bouton bouton-or' }, 'Enregistrer'),
        el('button', { type: 'button', class: 'bouton bouton-discret', onclick: fermerModale }, 'Annuler')));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      erreur.textContent = '';
      const f = new FormData(form);
      try {
        await pendant(form.querySelector('[type=submit]'), () => api('utilisateurs.modifier', {
          id: u.id, nomComplet: f.get('nomComplet'), role: f.get('role'), fuseau: f.get('fuseau')
        }));
        fermerModale();
        notifier('Utilisateur modifié.');
        ouvrirVue('utilisateurs');
      } catch (e) { erreur.textContent = e.message; }
    });
    ouvrirModale(form);
  }

  /* ================================================================
   * VUE : JOURNAL D'AUDIT (Admin)
   * ================================================================ */

  const filtresJournal = { page: 1, parPage: 30, recherche: '', action: '', du: '', au: '' };

  function blocJson(titre, texte) {
    if (!texte) return null;
    let joli = texte;
    try { joli = JSON.stringify(JSON.parse(texte), null, 1); } catch (e) { /* tel quel */ }
    return el('details', {}, el('summary', { class: 'element-detail' }, titre), el('pre', { class: 'json' }, joli));
  }

  async function vueJournal(vue) {
    const res = await api('audit.lister', filtresJournal);
    const resultatIntegrite = el('div');

    const champ = (nom, libelle, type) => {
      const i = el('input', { name: nom, type: type || 'text', autocomplete: 'off' });
      i.value = filtresJournal[nom];
      return el('label', {}, libelle, i);
    };
    const form = el('form', { class: 'filtres' },
      champ('recherche', 'Recherche'), champ('action', 'Code action'), champ('du', 'Du', 'date'), champ('au', 'Au', 'date'));
    const appliquer = el('button', { type: 'button', class: 'bouton bouton-or bouton-petit', onclick: () => {
      const f = new FormData(form);
      ['recherche', 'action', 'du', 'au'].forEach((k) => { filtresJournal[k] = String(f.get(k) || '').trim(); });
      filtresJournal.action = filtresJournal.action.toUpperCase();
      filtresJournal.page = 1;
      ouvrirVue('journal');
    } }, 'Filtrer');
    form.addEventListener('submit', (ev) => { ev.preventDefault(); appliquer.click(); });

    const verifier = el('button', { type: 'button', class: 'bouton bouton-discret bouton-petit', onclick: async (ev) => {
      try {
        const r = await pendant(ev.currentTarget, () => api('audit.verifierIntegrite'));
        resultatIntegrite.replaceChildren(el('p', { class: r.integre ? 'bandeau bandeau-vert' : 'bandeau bandeau-rouge' },
          (r.integre ? '✅ ' : '⚠️ ALERTE : ') + r.message));
      } catch (e) { notifier(e.message, true); }
    } }, 'Vérifier l\'intégrité du journal');

    const nbPages = Math.max(1, Math.ceil(res.total / res.parPage));
    const changerPage = (delta) => { filtresJournal.page = Math.min(nbPages, Math.max(1, res.page + delta)); ouvrirVue('journal'); };

    vue.replaceChildren(
      el('div', { class: 'carte' },
        el('h1', {}, 'Journal d\'audit'),
        el('p', { class: 'aide' }, 'Toutes les actions sont enregistrées ici et ne peuvent être ni modifiées ni supprimées. ',
          'Chaque ligne est scellée par une empreinte liée à la précédente : toute retouche manuelle est détectée.'),
        verifier, resultatIntegrite),
      el('div', { class: 'carte' }, form, appliquer),
      el('div', { class: 'carte' },
        el('p', { class: 'aide' }, res.total + ' entrée(s)'),
        el('ul', { class: 'liste' }, ...res.entrees.map((e) =>
          el('li', { class: 'element' },
            el('div', { class: 'element-titre' }, el('span', {}, e.Action), el('span', { class: 'element-detail' }, formatDate(e.DateUTC))),
            el('div', { class: 'element-detail' }, (e.UtilisateurNom || '—') + (e.Table ? ' — ' + e.Table : '') + (e.EnregistrementId ? ' — ' + e.EnregistrementId : '')),
            blocJson('Ancienne valeur', e.AncienneValeur),
            blocJson('Nouvelle valeur', e.NouvelleValeur),
            blocJson('Détails', e.Details)))),
        el('div', { class: 'pagination' },
          el('button', { type: 'button', class: 'bouton bouton-discret bouton-petit', disabled: res.page <= 1, onclick: () => changerPage(-1) }, '← Récents'),
          el('span', { class: 'aide' }, 'Page ' + res.page + ' / ' + nbPages),
          el('button', { type: 'button', class: 'bouton bouton-discret bouton-petit', disabled: res.page >= nbPages, onclick: () => changerPage(1) }, 'Anciens →'))));
  }

  /* ================================================================
   * DÉMARRAGE
   * ================================================================ */

  function brancherFormulaires() {
    // Connexion
    const fc = $('#form-connexion');
    fc.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = $('.message-erreur', fc);
      err.textContent = '';
      const f = new FormData(fc);
      try {
        const r = await pendant($('[type=submit]', fc), () => api('auth.connexion', {
          identifiant: f.get('identifiant'), motDePasse: f.get('motDePasse'),
          appareil: navigator.userAgent.slice(0, 200)
        }));
        fc.reset();
        memoriserSession(r.jeton);
        entrerDansApp(r.utilisateur, r.expireLe);
      } catch (e) { err.textContent = e.message; }
    });

    // Changement de mot de passe
    const fm = $('#form-mdp');
    fm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = $('.message-erreur', fm);
      err.textContent = '';
      const f = new FormData(fm);
      if (f.get('nouveau') !== f.get('confirmation')) { err.textContent = 'Les deux nouveaux mots de passe ne sont pas identiques.'; return; }
      try {
        await pendant($('[type=submit]', fm), () => api('auth.changerMotDePasse', { ancien: f.get('ancien'), nouveau: f.get('nouveau') }));
        fm.reset();
        notifier('Mot de passe enregistré.');
        const moi = await api('auth.moi');
        entrerDansApp(moi.utilisateur, moi.expireLe);
      } catch (e) {
        // La réponse du serveur a pu se perdre alors que le changement a réussi :
        // on vérifie avant d'afficher une erreur (sinon un nouvel essai serait refusé).
        if (e.code === 'RESEAU') {
          try {
            const moi = await api('auth.moi');
            if (!moi.utilisateur.doitChangerMdp) {
              fm.reset();
              notifier('Mot de passe enregistré.');
              entrerDansApp(moi.utilisateur, moi.expireLe);
              return;
            }
          } catch (e2) { /* on affiche l'erreur d'origine */ }
        }
        err.textContent = e.message;
      }
    });

    // Boutons « Se déconnecter » / « Quitter »
    document.querySelectorAll('[data-action="deconnexion"]').forEach((b) => b.addEventListener('click', deconnexion));

    // Fermer la modale en touchant l'arrière-plan
    $('#modale').addEventListener('click', (ev) => { if (ev.target.id === 'modale') fermerModale(); });
  }

  async function demarrer() {
    brancherFormulaires();
    if (!API_URL || API_URL.indexOf('https://') !== 0) $('#alerte-config').hidden = false;

    try { etat.jeton = localStorage.getItem(CLE_JETON); } catch (e) { etat.jeton = null; }
    if (!etat.jeton) { afficherEcran('connexion'); return; }
    try {
      const moi = await api('auth.moi');
      entrerDansApp(moi.utilisateur, moi.expireLe);
    } catch (e) {
      if (e.code !== 'MDP_A_CHANGER') { oublierSession(); afficherEcran('connexion'); }
    }
  }

  // Déconnexion automatique à l'expiration de la session (vérifiée chaque minute).
  setInterval(() => {
    if (etat.expireLe && new Date().toISOString() >= etat.expireLe) {
      oublierSession(); fermerModale(); afficherEcran('connexion');
      notifier('Session expirée : reconnectez-vous.', true);
    }
  }, 60000);

  /**
   * Boîte à outils partagée avec les autres fichiers du site (clients.js, …).
   * Chaque module appelle MBT.ajouterVue() pour ajouter son écran au menu.
   */
  window.MBT = {
    api, el, $, notifier, pendant, ouvrirModale, fermerModale, ouvrirVue,
    formatCad, formatFcfa, formatCadTexte, formatDate,
    utilisateur: () => etat.utilisateur,
    estAdmin: () => !!etat.utilisateur && etat.utilisateur.role === 'ADMIN',
    ajouterVue: (cle, definition) => { VUES[cle] = definition; }
  };

  document.addEventListener('DOMContentLoaded', demarrer);
})();
