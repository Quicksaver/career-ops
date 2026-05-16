// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { detectCustomProvider, fetchCustomProvider } from './_custom.mjs';

/** @type {Provider} */
export default {
  id: 'makeitingermany',
  detect(entry) {
    return detectCustomProvider('makeitingermany', entry);
  },
  fetch(entry) {
    return fetchCustomProvider('makeitingermany', entry);
  },
};
