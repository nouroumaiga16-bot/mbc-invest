/**
 * MBC Transfert — Gestion des utilisateurs (Admin uniquement)
 * Un utilisateur n'est jamais supprimé : on le désactive (traçabilité).
 */

function validerIdentifiant_(identifiant) {
  const s = String(identifiant || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(s)) {
    throw new ErreurMetier('IDENTIFIANT_INVALIDE',
      'Identifiant : 3 à 40 caractères, lettres minuscules sans accent, chiffres, point, tiret.');
  }
  return s;
}

function validerRole_(role) {
  if (!MBT.LIBELLES_ROLES[role]) throw new ErreurMetier('ROLE_INVALIDE', 'Rôle inconnu.');
  return role;
}

function validerFuseau_(fuseau) {
  const autorises = [MBT.FUSEAUX.MONTREAL, MBT.FUSEAUX.OUAGA];
  if (autorises.indexOf(fuseau) === -1) throw new ErreurMetier('FUSEAU_INVALIDE', 'Fuseau horaire inconnu.');
  return fuseau;
}

/** Fuseau par défaut selon le rôle. */
function fuseauParDefaut_(role) {
  return role === MBT.ROLES.AGENT_OUAGA ? MBT.FUSEAUX.OUAGA : MBT.FUSEAUX.MONTREAL;
}

function listerUtilisateurs_() {
  return lireTable_('Utilisateurs').map(function (u) {
    return {
      id: u.Id, identifiant: u.Identifiant, nomComplet: u.NomComplet, role: u.Role,
      libelleRole: MBT.LIBELLES_ROLES[u.Role] || u.Role, fuseau: u.Fuseau,
      actif: estOui_(u.Actif), doitChangerMdp: estOui_(u.DoitChangerMdp),
      bloqueJusqua: u.BloqueJusqua, derniereConnexion: u.DerniereConnexion, creeLe: u.CreeLe
    };
  });
}

/**
 * Crée un compte avec un mot de passe temporaire, affiché UNE seule fois à l'Admin.
 * L'utilisateur devra le changer à sa première connexion.
 */
function creerUtilisateur_(admin, donnees) {
  const identifiant = validerIdentifiant_(donnees.identifiant);
  const nom = texteObligatoire_(donnees.nomComplet, 'Nom complet', 100);
  const role = validerRole_(donnees.role);
  const fuseau = donnees.fuseau ? validerFuseau_(donnees.fuseau) : fuseauParDefaut_(role);
  return avecVerrou_(function () {
    if (trouverPar_('Utilisateurs', 'Identifiant', identifiant)) {
      throw new ErreurMetier('IDENTIFIANT_PRIS', 'Cet identifiant est déjà utilisé.');
    }
    const mdp = genererMdpTemporaire_();
    const u = ajouterLigne_('Utilisateurs', {
      Id: genererId_('USR'), Identifiant: identifiant, NomComplet: nom, Role: role, Fuseau: fuseau,
      MotDePasseHash: creerEmpreinteMdp_(mdp), DoitChangerMdp: 'OUI', Actif: 'OUI',
      TentativesEchouees: '0', CreeLe: maintenantUTC_(), CreePar: admin ? admin.Id : 'SYSTEME'
    });
    journaliser_(admin, 'UTILISATEUR_CREE', { table: 'Utilisateurs', id: u.Id, apres: u });
    return { id: u.Id, identifiant: identifiant, motDePasseTemporaire: mdp };
  });
}

/** Nombre d'administrateurs actifs (hors un utilisateur donné). */
function nbAdminsActifsSauf_(idExclu) {
  return lireTable_('Utilisateurs').filter(function (u) {
    return u.Id !== idExclu && u.Role === MBT.ROLES.ADMIN && estOui_(u.Actif);
  }).length;
}

/** Modifie nom, rôle, fuseau ou statut actif d'un utilisateur. */
function modifierUtilisateur_(admin, donnees) {
  return avecVerrou_(function () {
    const u = trouverParId_('Utilisateurs', donnees.id);
    if (!u) throw new ErreurMetier('INTROUVABLE', 'Utilisateur introuvable.');
    const ch = {};
    if (donnees.nomComplet !== undefined) ch.NomComplet = texteObligatoire_(donnees.nomComplet, 'Nom complet', 100);
    if (donnees.role !== undefined) ch.Role = validerRole_(donnees.role);
    if (donnees.fuseau !== undefined) ch.Fuseau = validerFuseau_(donnees.fuseau);
    if (donnees.actif !== undefined) ch.Actif = donnees.actif ? 'OUI' : 'NON';
    if (donnees.debloquer) { ch.BloqueJusqua = ''; ch.TentativesEchouees = '0'; }

    // Garde-fous : on ne peut pas se retirer soi-même ses droits, ni supprimer le dernier Admin.
    const retireAdmin = (ch.Role && ch.Role !== MBT.ROLES.ADMIN) || ch.Actif === 'NON';
    if (retireAdmin && u.Role === MBT.ROLES.ADMIN) {
      if (u.Id === admin.Id) throw new ErreurMetier('INTERDIT', 'Vous ne pouvez pas retirer vos propres droits Admin ni désactiver votre compte.');
      if (nbAdminsActifsSauf_(u.Id) === 0) throw new ErreurMetier('INTERDIT', 'Il doit rester au moins un Admin actif.');
    }
    if (!Object.keys(ch).length) return { ok: true, inchange: true };
    ch.ModifieLe = maintenantUTC_();
    ch.ModifiePar = admin.Id;
    const res = modifierLigne_('Utilisateurs', u.Id, ch);
    // Changement de rôle ou désactivation : on coupe les sessions ouvertes.
    if (ch.Actif === 'NON' || (ch.Role && ch.Role !== u.Role)) {
      fermerSessionsUtilisateur_(u.Id, 'Droits modifiés par l\'Admin');
    }
    journaliserModification_(admin, 'UTILISATEUR_MODIFIE', 'Utilisateurs', u.Id, res.avant, res.apres);
    return { ok: true };
  });
}

/** Réinitialise le mot de passe : nouveau mot de passe temporaire affiché une fois. */
function reinitialiserMdpUtilisateur_(admin, id) {
  return avecVerrou_(function () {
    const u = trouverParId_('Utilisateurs', id);
    if (!u) throw new ErreurMetier('INTROUVABLE', 'Utilisateur introuvable.');
    const mdp = genererMdpTemporaire_();
    modifierLigne_('Utilisateurs', u.Id, {
      MotDePasseHash: creerEmpreinteMdp_(mdp), DoitChangerMdp: 'OUI',
      TentativesEchouees: '0', BloqueJusqua: '', ModifieLe: maintenantUTC_(), ModifiePar: admin.Id
    });
    fermerSessionsUtilisateur_(u.Id, 'Mot de passe réinitialisé');
    journaliser_(admin, 'MDP_REINITIALISE', { table: 'Utilisateurs', id: u.Id });
    return { id: u.Id, identifiant: u.Identifiant, motDePasseTemporaire: mdp };
  });
}
