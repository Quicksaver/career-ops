// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { detectCustomProvider, fetchCustomProvider } from './_custom.mjs';

/** @type {Provider} */
export default {
  id: 'devitjobs',
  detect(entry) {
    return detectCustomProvider('devitjobs', entry);
  },
  fetch(entry, ctx) {
    return fetchCustomProvider('devitjobs', entry, ctx);
  },
};
