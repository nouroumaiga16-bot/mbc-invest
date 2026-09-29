/**
 * MBC Transfert — Point d'entrée du site web (API)
 * -------------------------------------------------
 * Le site (transfert.html) envoie toutes ses demandes ici, en POST :
 *   { action: 'parametres.lister', jeton: '…', donnees: { … } }
 * Réponse : { ok: true, donnees: … }  ou  { ok: false, code: '…', message: '…' }
 *
 * Pour CHAQUE action, on déclare ici quels rôles y ont droit. La vérification
 * se fait côté serveur : masquer un bouton dans le site ne suffit jamais.
 */

/**
 * Table des actions (construite à la demande : Apps Script ne garantit pas
 * l'ordre de chargement des fichiers, donc on ne lit MBT qu'à l'exécution).
 *  - public: true            → pas besoin d'être connecté (seulement la connexion)
 *  - roles: [...]             → rôles autorisés
 *  - avantChangementMdp: true → autorisée même si l'utilisateur doit encore changer son mot de passe
 *  - fn(contexte, donnees)    → la fonction à exécuter
 */
function actions_() {
  const TOUS_LES_ROLES_ = [MBT.ROLES.ADMIN, MBT.ROLES.AGENT_OUAGA, MBT.ROLES.AGENT_CANADA];
  const ADMIN_SEUL_ = [MBT.ROLES.ADMIN];
  return {
    'auth.connexion': {
      public: true,
      fn: function (ctx, d) { return connexion_(d.identifiant, d.motDePasse, d.appareil); }
    },
    'auth.moi': {
      roles: TOUS_LES_ROLES_, avantChangementMdp: true,
      fn: function (ctx) {
        return { utilisateur: profilPublic_(ctx.utilisateur), expireLe: ctx.session.ExpireLe, version: MBT.VERSION };
      }
    },
    'auth.deconnexion': {
      roles: TOUS_LES_ROLES_, avantChangementMdp: true,
      fn: function (ctx) { return deconnexion_(ctx); }
    },
    'auth.changerMotDePasse': {
      roles: TOUS_LES_ROLES_, avantChangementMdp: true,
      fn: function (ctx, d) { return changerMonMotDePasse_(ctx, d.ancien, d.nouveau); }
    },

    'parametres.lister': {
      roles: TOUS_LES_ROLES_, // l'agent ne reçoit que les paramètres « VisibleAgent » (filtré côté serveur)
      fn: function (ctx) { return listerParametres_(ctx.utilisateur); }
    },
    'parametres.modifier': {
      roles: ADMIN_SEUL_,
      fn: function (ctx, d) { return modifierParametre_(ctx.utilisateur, d.cle, d.valeur, d.justification); }
    },

    'utilisateurs.lister': {
      roles: ADMIN_SEUL_,
      fn: function () { return listerUtilisateurs_(); }
    },
    'utilisateurs.creer': {
      roles: ADMIN_SEUL_,
      fn: function (ctx, d) { return creerUtilisateur_(ctx.utilisateur, d); }
    },
    'utilisateurs.modifier': {
      roles: ADMIN_SEUL_,
      fn: function (ctx, d) { return modifierUtilisateur_(ctx.utilisateur, d); }
    },
    'utilisateurs.reinitialiserMdp': {
      roles: ADMIN_SEUL_,
      fn: function (ctx, d) { return reinitialiserMdpUtilisateur_(ctx.utilisateur, d.id); }
    },

    // --- Clients et bénéficiaires (phase 2) ---
    'clients.referentiels': {
      roles: TOUS_LES_ROLES_,
      fn: function () {
        return { typesPiece: MBT.TYPES_PIECE, statuts: MBT.STATUTS_CLIENT, typesImage: MBT.TYPES_IMAGE };
      }
    },
    'clients.lister': {
      roles: TOUS_LES_ROLES_,
      fn: function (ctx, d) { return listerClients_(d); }
    },
    'clients.fiche': {
      roles: TOUS_LES_ROLES_,
      fn: function (ctx, d) { return ficheClient_(ctx.utilisateur, d); }
    },
    'clients.creer': {
      roles: TOUS_LES_ROLES_,
      fn: function (ctx, d) { return creerClient_(ctx.utilisateur, d); }
    },
    'clients.modifier': {
      roles: TOUS_LES_ROLES_, // un agent ne peut modifier qu'un client « Nouveau » (contrôlé dans modifierClient_)
      fn: function (ctx, d) { return modifierClient_(ctx.utilisateur, d); }
    },
    'clients.televerserPhoto': {
      roles: TOUS_LES_ROLES_,
      fn: function (ctx, d) { return televerserPhotoClient_(ctx.utilisateur, d); }
    },
    'clients.photo': {
      roles: ADMIN_SEUL_,
      fn: function (ctx, d) { return photoClient_(ctx.utilisateur, d); }
    },
    'clients.verifier': {
      roles: ADMIN_SEUL_,
      fn: function (ctx, d) { return verifierClient_(ctx.utilisateur, d); }
    },
    'clients.bloquer': {
      roles: ADMIN_SEUL_,
      fn: function (ctx, d) { return bloquerClient_(ctx.utilisateur, d); }
    },
    'clients.debloquer': {
      roles: ADMIN_SEUL_,
      fn: function (ctx, d) { return debloquerClient_(ctx.utilisateur, d); }
    },
    'beneficiaires.creer': {
      roles: TOUS_LES_ROLES_,
      fn: function (ctx, d) { return creerBeneficiaire_(ctx.utilisateur, d); }
    },
    'beneficiaires.modifier': {
      roles: TOUS_LES_ROLES_, // seule la désactivation est réservée à l'Admin (contrôlé dans modifierBeneficiaire_)
      fn: function (ctx, d) { return modifierBeneficiaire_(ctx.utilisateur, d); }
    },

    'audit.lister': {
      roles: ADMIN_SEUL_,
      fn: function (ctx, d) { return listerJournal_(d); }
    },
    'audit.verifierIntegrite': {
      roles: ADMIN_SEUL_,
      fn: function (ctx) {
        const r = verifierIntegriteJournal_();
        journaliser_(ctx.utilisateur, 'AUDIT_VERIFIE', { details: { integre: r.integre, nbEntrees: r.nbEntrees } });
        return r;
      }
    }
  };
}

/** Réponse JSON. */
function reponseJson_(objet) {
  return ContentService.createTextOutput(JSON.stringify(objet))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Toutes les demandes du site arrivent ici. */
function doPost(e) {
  return reponseJson_(traiterDemande_(e && e.postData ? e.postData.contents : ''));
}

/** Une simple visite de l'adresse de l'API ne renvoie aucune donnée. */
function doGet() {
  return reponseJson_({ ok: true, service: MBT.NOM, message: 'API active.' });
}

/**
 * Traitement d'une demande (séparé de doPost pour pouvoir être testé).
 * @param {string} corps  le texte JSON reçu
 */
function traiterDemande_(corps) {
  let nomAction = '';
  try {
    let demande;
    try { demande = JSON.parse(corps || '{}'); } catch (err) {
      throw new ErreurMetier('REQUETE_INVALIDE', 'Demande illisible.');
    }
    nomAction = String(demande.action || '');
    const actions = actions_();
    const action = Object.prototype.hasOwnProperty.call(actions, nomAction) ? actions[nomAction] : null;
    if (!action) throw new ErreurMetier('ACTION_INCONNUE', 'Action inconnue.');
    const donnees = (demande.donnees && typeof demande.donnees === 'object') ? demande.donnees : {};

    if (action.public) {
      return { ok: true, donnees: action.fn(null, donnees) };
    }

    // 1) Session valide ?  2) Mot de passe à changer ?  3) Rôle autorisé ?
    const ctx = authentifier_(demande.jeton);
    if (estOui_(ctx.utilisateur.DoitChangerMdp) && !action.avantChangementMdp) {
      throw new ErreurMetier('MDP_A_CHANGER', 'Vous devez d\'abord changer votre mot de passe.');
    }
    exigerRole_(ctx.utilisateur, action.roles);
    return { ok: true, donnees: action.fn(ctx, donnees) };
  } catch (err) {
    if (err instanceof ErreurMetier) {
      return { ok: false, code: err.code, message: err.message };
    }
    // Erreur technique : détail dans les journaux Apps Script, message neutre pour l'utilisateur.
    console.error('Erreur technique [' + nomAction + '] : ' + (err && err.stack ? err.stack : err));
    return { ok: false, code: 'ERREUR_TECHNIQUE', message: 'Une erreur technique est survenue. Réessayez ; si elle persiste, prévenez l\'administrateur.' };
  }
}
