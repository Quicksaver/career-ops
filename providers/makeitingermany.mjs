// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { detectCustomProvider, fetchCustomProvider } from './_custom.mjs';

/** @type {Provider} */
export default {
  id: 'makeitingermany',
  detect(entry) {
    return detectCustomProvider('makeitingermany', entry);
  },
  fetch(entry, ctx) {
    return fetchCustomProvider('makeitingermany', entry, ctx);
  },
};
