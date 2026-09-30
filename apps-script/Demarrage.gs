/**
 * MBC Transfert — Installation en un clic depuis l'éditeur Apps Script
 * ---------------------------------------------------------------------
 * Mode d'emploi :
 *   1. En haut de l'éditeur, choisissez la fonction « INSTALLER_TOUT » ;
 *   2. cliquez sur « Exécuter » et acceptez les autorisations ;
 *   3. lisez le résultat dans le « Journal d'exécution » (en bas) :
 *      votre identifiant et votre MOT DE PASSE TEMPORAIRE y sont affichés.
 *
 * Sans danger si on la relance : rien n'est effacé, et le compte Admin
 * n'est créé qu'une seule fois.
 */
function INSTALLER_TOUT() {
  const rapport = installer();
  console.log('✅ INSTALLATION TERMINÉE');
  rapport.forEach(function (ligne) { console.log('   • ' + ligne); });

  // Premier taux automatique tout de suite (sans attendre la tâche des 6 h).
  const taux = majTauxAutomatique(true);
  console.log(taux.statut === 'ENREGISTRE'
    ? '💱 Taux du jour enregistré automatiquement : ' + taux.tauxReference + ' FCFA pour 1 CAD (' + taux.commentaire + ')'
    : '💱 Taux automatique : ' + taux.statut + (taux.message ? ' — ' + taux.message : ''));

  const adminExiste = lireTable_('Utilisateurs').some(function (u) { return u.Role === MBT.ROLES.ADMIN; });
  if (adminExiste) {
    console.log('ℹ️ Le compte Administrateur existe déjà : connectez-vous avec votre mot de passe habituel.');
    return;
  }
  const res = creerUtilisateur_(null, {
    identifiant: 'nourou', nomComplet: 'Nourou Maiga',
    role: MBT.ROLES.ADMIN, fuseau: MBT.FUSEAUX.MONTREAL
  });
  console.log('==============================================');
  console.log('🔑 COMPTE ADMINISTRATEUR CRÉÉ');
  console.log('   Identifiant             : ' + res.identifiant);
  console.log('   Mot de passe temporaire : ' + res.motDePasseTemporaire);
  console.log('   Notez-le maintenant. Vous choisirez votre propre mot de passe à la première connexion.');
  console.log('==============================================');
}

/**
 * Mot de passe perdu ou oublié : génère un nouveau mot de passe temporaire
 * pour le compte « nourou », débloque le compte et ferme les sessions ouvertes.
 * Mode d'emploi : choisir « REINITIALISER_MOT_DE_PASSE » en haut de l'éditeur,
 * cliquer sur « Exécuter », puis lire le mot de passe dans le Journal d'exécution.
 * (Seul le propriétaire du projet Apps Script peut faire cela.)
 */
function REINITIALISER_MOT_DE_PASSE() {
  const u = trouverPar_('Utilisateurs', 'Identifiant', 'nourou') ||
    lireTable_('Utilisateurs').filter(function (x) { return x.Role === MBT.ROLES.ADMIN; })[0];
  if (!u) {
    console.log('Aucun compte Administrateur : lancez INSTALLER_TOUT.');
    return;
  }
  const mdp = genererMdpTemporaire_();
  modifierLigne_('Utilisateurs', u.Id, {
    MotDePasseHash: creerEmpreinteMdp_(mdp), DoitChangerMdp: 'OUI', Actif: 'OUI',
    TentativesEchouees: '0', BloqueJusqua: '', ModifieLe: maintenantUTC_(), ModifiePar: 'EDITEUR_APPS_SCRIPT'
  });
  fermerSessionsUtilisateur_(u.Id, 'Mot de passe réinitialisé depuis l\'éditeur');
  journaliser_(null, 'MDP_REINITIALISE', { table: 'Utilisateurs', id: u.Id, details: { origine: 'Éditeur Apps Script' } });
  console.log('==============================================');
  console.log('🔑 NOUVEAU MOT DE PASSE TEMPORAIRE');
  console.log('   Identifiant             : ' + u.Identifiant);
  console.log('   Mot de passe temporaire : ' + mdp);
  console.log('   Vous choisirez votre propre mot de passe à la connexion.');
  console.log('==============================================');
}
