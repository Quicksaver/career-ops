// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { detectCustomProvider, fetchCustomProvider } from './_custom.mjs';

/** @type {Provider} */
export default {
  id: 'swissdevjobs',
  detect(entry) {
    return detectCustomProvider('swissdevjobs', entry);
  },
  fetch(entry, ctx) {
    return fetchCustomProvider('swissdevjobs', entry, ctx);
  },
};
