/**
 * Le SHA-256 écrit en JavaScript doit donner exactement le même résultat que le
 * SHA-256 standard (sinon les mots de passe existants ne fonctionneraient plus).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const vm = require('vm');
const { creerEnvironnement } = require('./simulateur-google');

test('SHA-256 JavaScript identique au SHA-256 standard (accents, emoji, textes longs)', () => {
  const ctx = creerEnvironnement();
  const textes = ['', 'abc', 'Ouédraogo — Larlé', '💱 taux', 'x'.repeat(55), 'y'.repeat(56), 'z'.repeat(64), 'w'.repeat(1000)];
  for (let i = 0; i < 200; i++) textes.push(crypto.randomBytes(1 + (i % 90)).toString('base64') + 'é€' + i);
  textes.forEach((t) => {
    const attendu = crypto.createHash('sha256').update(t, 'utf8').digest('hex');
    assert.equal(vm.runInContext('sha256JsHex_(' + JSON.stringify(t) + ')', ctx), attendu, t);
  });
});

test('Un mot de passe enregistré avec l\'ancienne méthode reste valable', () => {
  const ctx = creerEnvironnement();
  // Empreinte calculée comme avant (service de hachage standard), 1000 tours.
  const sel = 'abcdef0123456789';
  let h = crypto.createHash('sha256').update(sel + ':MonSecret2026', 'utf8').digest('hex');
  for (let i = 1; i < 1000; i++) h = crypto.createHash('sha256').update(h + ':' + sel, 'utf8').digest('hex');
  const empreinte = 'v1$1000$' + sel + '$' + h;
  assert.equal(vm.runInContext(`verifierMdp_('MonSecret2026', ${JSON.stringify(empreinte)})`, ctx), true);
  assert.equal(vm.runInContext(`verifierMdp_('mauvais', ${JSON.stringify(empreinte)})`, ctx), false);
});
