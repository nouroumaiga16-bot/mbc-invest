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
