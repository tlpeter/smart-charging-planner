'use strict';

// More than one charger: everything the app keeps per charger (the plan,
// Charge now, Ready for, the control state and log, …) lives in a scope per
// charger. Code runs for one charger with run(id, fn); inside, id() is that
// charger. Outside a run (one charger, timers that run before the chargers
// are known) it is the first charger.
//
// Files: the first charger of the app ("charger1", also every app from
// before more chargers) keeps the old file names (boost.json); another
// charger has its own (boost-charger2.json).

const { AsyncLocalStorage } = require('async_hooks');

const LEGACY = 'charger1';
const als = new AsyncLocalStorage();
let primary = LEGACY;

function id() {
  const s = als.getStore();
  return (s && s.id) || primary;
}

function run(chargerId, fn) {
  return als.run({ id: chargerId || primary }, fn);
}

function setPrimary(chargerId) {
  primary = chargerId || LEGACY;
}

function isPrimary() {
  return id() === primary;
}

// The file of the current charger: boost.json, boost-charger2.json, …
function file(p) {
  const k = id();
  return k === LEGACY ? p : p.replace(/(\.[a-z]+)$/i, `-${k}$1`);
}

// Per-charger state: store(() => ({ … }))() is the object of the current charger.
function store(init) {
  const all = new Map();
  const get = () => {
    const k = id();
    if (!all.has(k)) all.set(k, init());
    return all.get(k);
  };
  get.all = all;
  get.reset = () => all.clear();
  return get;
}

module.exports = { id, run, setPrimary, isPrimary, file, store, LEGACY };
