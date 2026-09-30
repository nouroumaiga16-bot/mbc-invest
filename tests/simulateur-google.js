/**
 * Simulateur minimal des services Google Apps Script, pour tester le code
 * du dossier apps-script/ sur un ordinateur avec Node.js (sans Google).
 * Il reproduit seulement ce dont MBC Transfert a besoin.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function creerFeuille(nom) {
  const donnees = []; // tableau de lignes (tableaux de textes)
  const protections = [];
  const feuille = {
    _donnees: donnees,
    getName: () => nom,
    getLastRow: () => {
      for (let i = donnees.length - 1; i >= 0; i--) {
        if (donnees[i] && donnees[i].some(v => v !== '' && v !== undefined)) return i + 1;
      }
      return 0;
    },
    getLastColumn: () => {
      let max = 0;
      donnees.forEach(l => { for (let j = (l || []).length - 1; j >= 0; j--) { if (l[j] !== '' && l[j] !== undefined) { max = Math.max(max, j + 1); break; } } });
      return max;
    },
    getMaxRows: () => Math.max(1000, donnees.length),
    getRange: (r, c, nr, nc) => creerPlage(donnees, r, c, nr || 1, nc || 1),
    setFrozenRows: () => {},
    protect: () => { const p = { setDescription: () => p, setWarningOnly: () => p }; protections.push(p); return p; },
    getProtections: () => protections
  };
  return feuille;
}

// Une cellule écrite avec une apostrophe devant est relue sans (comme Google Sheets).
const nettoyer = v => (typeof v === 'string' && v.charAt(0) === '\'') ? v.slice(1) : (v === undefined || v === null ? '' : v);

function creerPlage(donnees, r, c, nr, nc) {
  const plage = {
    getValues: () => {
      const res = [];
      for (let i = 0; i < nr; i++) {
        const l = donnees[r - 1 + i] || [];
        const ligne = [];
        for (let j = 0; j < nc; j++) ligne.push(l[c - 1 + j] === undefined ? '' : l[c - 1 + j]);
        res.push(ligne);
      }
      return res;
    },
    getValue: () => plage.getValues()[0][0],
    setValues: (vals) => {
      if (vals.length !== nr || vals[0].length !== nc) throw new Error('Dimensions incorrectes');
      for (let i = 0; i < nr; i++) {
        donnees[r - 1 + i] = donnees[r - 1 + i] || [];
        for (let j = 0; j < nc; j++) donnees[r - 1 + i][c - 1 + j] = nettoyer(vals[i][j]);
      }
      return plage;
    },
    setValue: (v) => plage.setValues([[v]]),
    setNumberFormat: () => plage,
    setFontWeight: () => plage,
    setBackground: () => plage,
    setFontColor: () => plage
  };
  return plage;
}

function creerEnvironnement(options) {
  const feuilles = {};
  const ordre = [];
  const classeur = {
    getId: () => 'CLASSEUR-TEST',
    getUrl: () => 'https://docs.google.com/spreadsheets/d/CLASSEUR-TEST',
    getSheetByName: (n) => feuilles[n] || null,
    insertSheet: (n) => { feuilles[n] = creerFeuille(n); ordre.push(n); return feuilles[n]; },
    getSheets: () => ordre.map(n => feuilles[n]),
    deleteSheet: (f) => { delete feuilles[f.getName()]; ordre.splice(ordre.indexOf(f.getName()), 1); }
  };
  const proprietes = {};
  // Faux Google Drive : dossiers et fichiers en mémoire.
  const dossiers = {};
  const fichiers = {};
  let compteurDrive = 0;
  function creerDossier(nom) {
    const id = 'DOSSIER-' + (++compteurDrive);
    const enfants = [];
    const d = {
      getId: () => id, getName: () => nom, _fichiers: [],
      getFoldersByName: (n) => { const t = enfants.filter(e => e.getName() === n); let i = 0; return { hasNext: () => i < t.length, next: () => t[i++] }; },
      createFolder: (n) => { const e = creerDossier(n); enfants.push(e); return e; },
      createFile: (blob) => {
        const fid = 'FICHIER-' + (++compteurDrive);
        fichiers[fid] = { getId: () => fid, getName: () => blob.nom, getBlob: () => blob, _dossier: d };
        d._fichiers.push(fichiers[fid]);
        return fichiers[fid];
      }
    };
    dossiers[id] = d;
    return d;
  }
  const alertes = [];
  const reponsesPrompt = [];

  const ctx = {
    console: { log: (...a) => ctx.__journal.push(a.join(' ')), error: (...a) => ctx.__erreurs.push(a.join(' ')) },
    __journal: [],
    __internet: {},
    __erreurs: [],
    __alertes: alertes,
    __reponsesPrompt: reponsesPrompt,
    __feuilles: feuilles,
    __fichiers: fichiers,
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (algo, texte) => Array.from(crypto.createHash(algo).update(String(texte), 'utf8').digest()).map(b => b > 127 ? b - 256 : b),
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, fuseau, format) => {
        const p = new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
          .formatToParts(d).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
        return format.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day)
          .replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second);
      },
      base64Decode: (s) => {
        if (!/^[A-Za-z0-9+/=\s]*$/.test(s)) throw new Error('base64 invalide');
        return Array.from(Buffer.from(s, 'base64')).map(b => b > 127 ? b - 256 : b);
      },
      base64Encode: (octets) => Buffer.from(octets.map(b => b & 0xff)).toString('base64'),
      newBlob: (octets, mime, nom) => ({ octets, mime, nom, getBytes: () => octets, getContentType: () => mime, getName: () => nom })
    },
    SpreadsheetApp: {
      // Option « scriptIndependant » : script lancé depuis l'éditeur, sans classeur attaché ni interface.
      getActiveSpreadsheet: () => (options && options.scriptIndependant ? null : classeur),
      openById: () => classeur,
      create: () => classeur,
      flush: () => {},
      ProtectionType: { SHEET: 'SHEET' },
      getUi: () => { if (options && options.scriptIndependant) throw new Error('Cannot call SpreadsheetApp.getUi() from this context'); return {
        alert: (...a) => { alertes.push(a.filter(x => typeof x === 'string').join(' | ')); },
        prompt: () => ({ getSelectedButton: () => 'OK', getResponseText: () => reponsesPrompt.shift() }),
        ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL' },
        Button: { OK: 'OK' },
        createMenu: () => { const m = { addItem: () => m, addSeparator: () => m, addToUi: () => m }; return m; }
      }; }
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in proprietes ? proprietes[k] : null),
        setProperty: (k, v) => { proprietes[k] = String(v); }
      })
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    DriveApp: {
      createFolder: (nom) => creerDossier(nom),
      getFolderById: (id) => { if (!dossiers[id]) throw new Error('introuvable'); return dossiers[id]; },
      getFileById: (id) => { if (!fichiers[id]) throw new Error('introuvable'); return fichiers[id]; }
    },
    ScriptApp: {
      getProjectTriggers: () => [],
      newTrigger: () => { const t = { timeBased: () => t, everyDays: () => t, everyHours: () => t, atHour: () => t, create: () => t }; return t; }
    },
    // Faux Internet : ctx.__internet[url] = { code, texte } ; par défaut, cours BCE 1 € = 1,4723 CAD.
    UrlFetchApp: {
      fetch: (url) => {
        const r = ctx.__internet[url] || (url.indexOf('ecb.europa.eu') !== -1
          ? { code: 200, texte: "<Cube time='2026-09-29'><Cube currency='USD' rate='1.08'/><Cube currency='CAD' rate='1.4723'/></Cube>" }
          : { code: 503, texte: '' });
        if (r.erreurReseau) throw new Error('Réseau indisponible');
        return { getResponseCode: () => r.code, getContentText: () => r.texte };
      }
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s) => ({ contenu: s, setMimeType() { return this; } })
    }
  };
  vm.createContext(ctx);

  // On charge les fichiers dans l'ordre alphabétique INVERSE pour vérifier
  // qu'aucun fichier ne dépend de l'ordre de chargement.
  if (options && options.fichierUnique) {
    // Version « tout en un » (installation/Code.gs).
    vm.runInContext(fs.readFileSync(options.fichierUnique, 'utf8'), ctx, { filename: 'Code.gs' });
    return ctx;
  }
  const dossier = path.join(__dirname, '..', 'apps-script');
  fs.readdirSync(dossier).filter(f => f.endsWith('.gs')).sort().reverse().forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(dossier, f), 'utf8'), ctx, { filename: f });
  });
  return ctx;
}

module.exports = { creerEnvironnement };
