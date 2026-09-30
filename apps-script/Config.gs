/**
 * MBC Transfert — Configuration générale
 * ---------------------------------------
 * Ce fichier décrit :
 *  - les rôles et fuseaux horaires ;
 *  - la structure de chaque onglet (table) du classeur Google Sheets ;
 *  - les paramètres par défaut (seuils, marges, délais…).
 *
 * IMPORTANT : les valeurs des paramètres ci-dessous ne sont que des valeurs
 * de DÉPART. Elles sont copiées dans l'onglet « Parametres » à l'installation,
 * puis modifiées uniquement depuis l'écran Paramètres (Admin). Le code lit
 * toujours la valeur de l'onglet, jamais celle d'ici.
 */

const MBT = {
  VERSION: '1.2.0-phase3',
  NOM: 'MBC Transfert',

  ROLES: {
    ADMIN: 'ADMIN',
    AGENT_OUAGA: 'AGENT_OUAGA',
    AGENT_CANADA: 'AGENT_CANADA'
  },

  LIBELLES_ROLES: {
    ADMIN: 'Administrateur',
    AGENT_OUAGA: 'Agent Ouaga',
    AGENT_CANADA: 'Agent Canada'
  },

  FUSEAUX: {
    MONTREAL: 'America/Toronto',
    OUAGA: 'Africa/Ouagadougou'
  },

  // Nombre de tours de hachage des mots de passe (ralentit les attaques par force brute).
  // Stocké dans chaque empreinte : on peut l'augmenter plus tard sans casser les anciens comptes.
  HACHAGE_ITERATIONS: 1000,

  // Statuts d'un client (KYC).
  STATUTS_CLIENT: {
    NOUVEAU: 'Nouveau',
    VERIFIE: 'Vérifié',
    BLOQUE: 'Bloqué'
  },

  // Types de pièce d'identité acceptés (AUTRE : préciser laquelle).
  TYPES_PIECE: {
    CNIB: 'CNIB',
    PASSEPORT: 'Passeport',
    PERMIS: 'Permis de conduire',
    RESIDENT_PERMANENT: 'Carte de résident permanent',
    CARTE_SEJOUR: 'Carte de séjour',
    AUTRE: 'Autre'
  },

  // Statuts d'une transaction (utilisés à partir de la phase 3).
  STATUTS_TRANSACTION: {
    BROUILLON: 'Brouillon',
    EN_ATTENTE_PAIEMENT: 'En attente de paiement',
    PAIEMENT_CONFIRME: 'Paiement confirmé',
    VALIDEE: 'Validée',
    REMISE_AUTORISEE: 'Remise autorisée',
    PAYEE: 'Payée au bénéficiaire',
    CLOTUREE: 'Clôturée',
    ANNULEE: 'Annulée',
    REMBOURSEE: 'Remboursée',
    BLOQUEE_CONFORMITE: 'Bloquée conformité'
  },

  // Formats de photo acceptés.
  TYPES_IMAGE: ['image/jpeg', 'image/png', 'image/webp'],

  // Clés utilisées dans les « Propriétés du script » (stockage privé côté serveur).
  PROPRIETES: {
    CLASSEUR_ID: 'CLASSEUR_ID',
    DOSSIER_PRIVE_ID: 'DOSSIER_PRIVE_ID'
  }
};

/**
 * Structure des tables : nom de l'onglet → liste des colonnes (ligne 1).
 * La première colonne est l'identifiant unique de la ligne.
 * Conventions :
 *  - dates : texte ISO en UTC (ex. 2026-09-29T21:30:00.000Z) ;
 *  - montants CAD : entiers en CENTIMES (colonnes suffixées « Centimes ») ;
 *  - montants FCFA : entiers (colonnes suffixées « Fcfa ») ;
 *  - taux : texte décimal (ex. « 432.5000 »), calculé en entiers côté code.
 * Les tables des phases suivantes sont créées dès maintenant ; des colonnes
 * pourront être ajoutées plus tard (l'installateur les ajoute sans rien effacer).
 */
const SCHEMA = {
  Utilisateurs: [
    'Id', 'Identifiant', 'NomComplet', 'Role', 'Fuseau', 'MotDePasseHash',
    'DoitChangerMdp', 'Actif', 'TentativesEchouees', 'BloqueJusqua',
    'DerniereConnexion', 'CreeLe', 'CreePar', 'ModifieLe', 'ModifiePar'
  ],
  Sessions: [
    'Id', 'JetonHash', 'UtilisateurId', 'CreeLe', 'ExpireLe',
    'DerniereActivite', 'Active', 'Appareil', 'FermeeLe', 'MotifFermeture'
  ],
  Clients: [
    'Id', 'NumeroClient', 'NomComplet', 'DateNaissance', 'Adresse', 'Ville', 'Pays',
    'Telephone', 'Profession', 'TypePiece', 'NumeroPiece', 'ExpirationPiece',
    'PhotoRectoId', 'PhotoVersoId', 'Statut', 'Notes',
    'CreeLe', 'CreePar', 'ModifieLe', 'ModifiePar',
    // Ajouts phase 2
    'TypePieceAutre', 'PaysEmissionPiece', 'Email', 'VerifieLe', 'VerifiePar', 'MotifBlocage'
  ],
  Beneficiaires: [
    'Id', 'ClientId', 'NomComplet', 'Telephone', 'Ville', 'Pays', 'LienClient',
    'Actif', 'CreeLe', 'CreePar', 'ModifieLe', 'ModifiePar',
    // Ajouts phase 2
    'Notes'
  ],
  Taux: [
    'Id', 'DateUTC', 'TauxReference', 'MargeAType', 'MargeAValeur',
    'MargeBType', 'MargeBValeur', 'TauxFluxA', 'TauxFluxB', 'SaisiPar', 'Commentaire',
    // Ajout : origine du taux (AUTO = récupéré automatiquement, MANUEL = saisi par l'Admin)
    'Source'
  ],
  Transactions: [
    'Id', 'Numero', 'Flux', 'Statut', 'ClientId', 'BeneficiaireId', 'EntiteId',
    'MontantCadCentimes', 'MontantFcfa', 'TauxId', 'TauxApplique', 'TauxReference',
    'FraisCadCentimes', 'FraisFcfa', 'RevenuBrutCadCentimes',
    'ProvenanceFonds', 'MotifTransfert', 'ReferenceInterac', 'CodeRetraitHash',
    'Validation1Par', 'Validation1Le', 'Validation2Par', 'Validation2Le',
    'PayableApres', 'PieceBeneficiaireNumero', 'PreuveRemiseId', 'PayeePar', 'PayeeLe',
    'TransactionOrigineId', 'Notes', 'CreeLe', 'CreePar', 'ModifieLe', 'ModifiePar',
    // Ajouts phase 3
    'TotalClientCadCentimes', 'TotalClientFcfa', 'ReferencePaiement', 'ConfirmeePar', 'ConfirmeeLe',
    'ReferenceVersement', 'TentativesCodeEchouees', 'RemiseAutoriseePar', 'RemiseAutoriseeLe',
    'MotifAnnulation', 'ClotureePar', 'ClotureeLe'
  ],
  HistoriqueStatuts: [
    'Id', 'TransactionId', 'AncienStatut', 'NouveauStatut', 'DateUTC',
    'UtilisateurId', 'Commentaire'
  ],
  Caisses: [
    'Id', 'Code', 'Nom', 'Devise', 'Actif', 'CreeLe'
  ],
  MouvementsCaisse: [
    'Id', 'CaisseId', 'DateUTC', 'JourneeLocale', 'Type', 'Montant',
    'TransactionId', 'Reference', 'Commentaire', 'CreePar'
  ],
  Rapprochements: [
    'Id', 'CaisseId', 'Journee', 'SoldeTheorique', 'SoldeCompte', 'Ecart',
    'Justification', 'SaisiPar', 'SaisiLe', 'Cloturee', 'ClotureePar', 'ClotureeLe'
  ],
  Depenses: [
    'Id', 'Mois', 'DateUTC', 'Categorie', 'Description', 'Montant', 'Devise',
    'EquivalentCadCentimes', 'Reference', 'CreePar'
  ],
  Entites: [
    'Id', 'Code', 'Nom', 'Actif', 'TauxInterne', 'Notes', 'CreeLe'
  ],
  OperationsInternes: [
    'Id', 'EntiteId', 'TransactionId', 'Sens', 'MontantCadCentimes', 'MontantFcfa',
    'Taux', 'Mois', 'Statut', 'Commentaire', 'CreeLe', 'CreePar'
  ],
  AlertesConformite: [
    'Id', 'Type', 'DateUTC', 'ClientId', 'BeneficiaireId', 'TransactionIds',
    'Description', 'MontantAgregeCadCentimes', 'Statut', 'Justification',
    'DecidePar', 'DecideLe'
  ],
  Parametres: [
    'Cle', 'Valeur', 'Type', 'Categorie', 'Description', 'VisibleAgent',
    'ModifiePar', 'ModifieLe'
  ],
  JournalAudit: [
    'Id', 'DateUTC', 'UtilisateurId', 'UtilisateurNom', 'Role', 'Action',
    'Table', 'EnregistrementId', 'AncienneValeur', 'NouvelleValeur', 'Details',
    'HashPrecedent', 'Hash'
  ]
};

/** Colonne identifiant de chaque table (par défaut « Id »). */
const CLES_PRIMAIRES = {
  Parametres: 'Cle'
};

/**
 * Colonnes qu'on ne doit JAMAIS renvoyer au navigateur ni écrire dans le journal.
 */
const COLONNES_SECRETES = ['MotDePasseHash', 'JetonHash', 'CodeRetraitHash'];

/**
 * Paramètres par défaut.
 * Types possibles :
 *  - 'entier'   : nombre entier (ex. 24)
 *  - 'decimal'  : nombre à virgule (ex. 2.5)
 *  - 'cad'      : montant en dollars canadiens, 2 décimales (ex. 1000.00)
 *  - 'fcfa'     : montant en FCFA, entier (ex. 1000000)
 *  - 'booleen'  : OUI / NON
 *  - 'texte'    : texte libre
 *  - 'choix:A|B': une valeur parmi une liste
 *  - 'json'     : structure (ex. tranches de frais)
 * visibleAgent : true si l'agent peut lire ce paramètre (ex. adresse de la boutique).
 * Les seuils réglementaires sont À CONFIRMER par le conseiller en conformité.
 */
const PARAMETRES_DEFAUT = [
  // --- Sécurité ---
  { cle: 'SESSION_DUREE_HEURES', valeur: '8', type: 'entier', categorie: 'Sécurité',
    description: 'Durée de validité d\'une session de connexion (heures).' },
  { cle: 'CONNEXION_TENTATIVES_MAX', valeur: '5', type: 'entier', categorie: 'Sécurité',
    description: 'Nombre d\'échecs de mot de passe avant blocage temporaire du compte.' },
  { cle: 'CONNEXION_BLOCAGE_MINUTES', valeur: '15', type: 'entier', categorie: 'Sécurité',
    description: 'Durée du blocage temporaire après trop d\'échecs (minutes).' },

  // --- KYC / Conformité ---
  { cle: 'KYC_SEUIL_VERIFICATION_CAD', valeur: '1000.00', type: 'cad', categorie: 'Conformité',
    description: 'Au-dessus de ce montant, le client doit avoir le statut « Vérifié ». À confirmer par le conseiller.' },
  { cle: 'KYC_SEUIL_PROVENANCE_CAD', valeur: '1000.00', type: 'cad', categorie: 'Conformité',
    description: 'Au-dessus de ce montant, « provenance des fonds » et « motif » sont obligatoires. À confirmer.' },
  { cle: 'DECLARATION_SEUIL_CAD', valeur: '10000.00', type: 'cad', categorie: 'Conformité',
    description: 'Seuil de déclaration (seul ou agrégé sur la fenêtre). À confirmer par le conseiller.' },
  { cle: 'AGREGATION_FENETRE_HEURES', valeur: '24', type: 'entier', categorie: 'Conformité',
    description: 'Fenêtre d\'agrégation des transactions d\'un même client (règle des 24 h).' },
  { cle: 'FRACTIONNEMENT_MARGE_POURCENT', valeur: '10', type: 'decimal', categorie: 'Conformité',
    description: 'Un montant est « juste sous le seuil » s\'il est à moins de ce % du seuil.' },
  { cle: 'FRACTIONNEMENT_NB_MIN', valeur: '2', type: 'entier', categorie: 'Conformité',
    description: 'Nombre de montants « juste sous le seuil » sur la fenêtre qui déclenche une alerte.' },
  { cle: 'HAUSSE_VOLUME_FACTEUR', valeur: '3', type: 'decimal', categorie: 'Conformité',
    description: 'Alerte si le volume 30 jours d\'un client dépasse X fois sa moyenne mensuelle habituelle.' },
  { cle: 'CONSERVATION_ANNEES', valeur: '5', type: 'entier', categorie: 'Conformité',
    description: 'Durée de conservation des dossiers (années). À confirmer.' },

  // --- Clients (KYC) ---
  { cle: 'CLIENT_AGE_MIN', valeur: '18', type: 'entier', categorie: 'Conformité',
    description: 'Âge minimum d\'un client (0 = pas de contrôle). À confirmer par le conseiller.' },
  { cle: 'PIECE_ALERTE_EXPIRATION_JOURS', valeur: '30', type: 'entier', categorie: 'Conformité',
    description: 'Afficher un avertissement quand la pièce d\'identité expire dans moins de X jours.' },
  { cle: 'PHOTO_TAILLE_MAX_KO', valeur: '4000', type: 'entier', categorie: 'Conformité',
    description: 'Taille maximale d\'une photo téléversée (Ko), après compression par le site.' },

  // --- Taux et marges ---
  { cle: 'TAUX_VALIDITE_HEURES', valeur: '24', type: 'entier', categorie: 'Taux',
    description: 'Si aucun taux n\'a été saisi depuis ce délai, la création de transactions est bloquée.' },
  { cle: 'MARGE_A_TYPE', valeur: 'FCFA_PAR_CAD', type: 'choix:FCFA_PAR_CAD|POURCENT', categorie: 'Taux',
    description: 'Unité de la marge du flux A (envoi CAD → FCFA).' },
  { cle: 'MARGE_A_VALEUR', valeur: '10', type: 'decimal', categorie: 'Taux',
    description: 'Marge du flux A : taux A = référence − marge.' },
  { cle: 'MARGE_B_TYPE', valeur: 'FCFA_PAR_CAD', type: 'choix:FCFA_PAR_CAD|POURCENT', categorie: 'Taux',
    description: 'Unité de la marge du flux B (achat de CAD en FCFA).' },
  { cle: 'MARGE_B_VALEUR', valeur: '10', type: 'decimal', categorie: 'Taux',
    description: 'Marge du flux B : taux B = référence + marge.' },
  { cle: 'FRAIS_TRANCHES', type: 'json', categorie: 'Taux',
    valeur: JSON.stringify([
      { jusquaCad: 500, fraisCad: 5 },
      { jusquaCad: 1500, fraisCad: 10 },
      { jusquaCad: null, fraisCad: 15 }
    ]),
    description: 'Frais fixes par transaction selon le montant (jusquaCad: null = au-delà). Exemple à ajuster.' },

  { cle: 'TAUX_AUTO_ACTIF', valeur: 'OUI', type: 'booleen', categorie: 'Taux',
    description: 'OUI : le taux de référence est mis à jour automatiquement toutes les 6 h (cours officiel BCE, FCFA fixé à l\'euro). Une saisie manuelle reste prioritaire 24 h.' },
  { cle: 'TAUX_AUTO_ECART_FCFA', valeur: '0', type: 'decimal_signe', categorie: 'Taux',
    description: 'Écart ajouté au taux officiel pour obtenir votre taux de référence (FCFA par CAD, ex. -3 ou 2,5). 0 = taux officiel.' },
  { cle: 'TAUX_ECART_ALERTE_POURCENT', valeur: '5', type: 'decimal', categorie: 'Taux',
    description: 'Un nouveau taux de référence qui s\'écarte de plus de X % du précédent demande une confirmation (anti-faute de frappe).' },

  // --- Règles anti-pertes ---
  { cle: 'DOUBLE_VALIDATION_SEUIL_CAD', valeur: '3000.00', type: 'cad', categorie: 'Anti-pertes',
    description: 'Au-dessus de ce montant, deux validations Admin sont exigées.' },
  { cle: 'NOUVEAU_CLIENT_NB_TRANSACTIONS', valeur: '3', type: 'entier', categorie: 'Anti-pertes',
    description: 'Un client est « nouveau » pendant ses N premières transactions.' },
  { cle: 'NOUVEAU_CLIENT_DELAI_HEURES', valeur: '24', type: 'entier', categorie: 'Anti-pertes',
    description: 'Délai de sécurité entre confirmation du paiement et remise, pour un nouveau client.' },

  // --- Caisses ---
  { cle: 'CAISSE_CAD_MIN', valeur: '2000.00', type: 'cad', categorie: 'Caisses',
    description: 'Solde minimum de la caisse CAD (alerte rouge en dessous).' },
  { cle: 'CAISSE_CAD_MAX', valeur: '20000.00', type: 'cad', categorie: 'Caisses',
    description: 'Solde maximum souhaité de la caisse CAD.' },
  { cle: 'CAISSE_FCFA_MIN', valeur: '1000000', type: 'fcfa', categorie: 'Caisses',
    description: 'Solde minimum de la caisse FCFA (alerte rouge en dessous).' },
  { cle: 'CAISSE_FCFA_MAX', valeur: '10000000', type: 'fcfa', categorie: 'Caisses',
    description: 'Solde maximum souhaité de la caisse FCFA.' },
  { cle: 'RAPPROCHEMENT_ALERTE_CAD', valeur: '20.00', type: 'cad', categorie: 'Caisses',
    description: 'Écart de rapprochement CAD au-delà duquel une alerte Admin est levée.' },
  { cle: 'RAPPROCHEMENT_ALERTE_FCFA', valeur: '5000', type: 'fcfa', categorie: 'Caisses',
    description: 'Écart de rapprochement FCFA au-delà duquel une alerte Admin est levée.' },

  // --- Boutique (visible par les agents, utilisé dans les messages WhatsApp) ---
  { cle: 'BOUTIQUE_NOM', valeur: 'Boutique MBC Larlé', type: 'texte', categorie: 'Boutique', visibleAgent: true,
    description: 'Nom du point de service à Ouagadougou.' },
  { cle: 'BOUTIQUE_ADRESSE', valeur: 'Larlé, Ouagadougou (adresse à compléter)', type: 'texte', categorie: 'Boutique', visibleAgent: true,
    description: 'Adresse affichée aux bénéficiaires.' },
  { cle: 'BOUTIQUE_HORAIRES', valeur: 'Lun–Sam, 8 h – 18 h (à confirmer)', type: 'texte', categorie: 'Boutique', visibleAgent: true,
    description: 'Horaires d\'ouverture.' },
  { cle: 'BOUTIQUE_TELEPHONE', valeur: '+226 00 00 00 00', type: 'texte', categorie: 'Boutique', visibleAgent: true,
    description: 'Numéro à appeler.' }
];
