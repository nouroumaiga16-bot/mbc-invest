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
