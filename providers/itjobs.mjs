// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { detectCustomProvider, fetchCustomProvider } from './_custom.mjs';

/** @type {Provider} */
export default {
  id: 'itjobs',
  detect(entry) {
    return detectCustomProvider('itjobs', entry);
  },
  fetch(entry, ctx) {
    return fetchCustomProvider('itjobs', entry, ctx);
  },
};
