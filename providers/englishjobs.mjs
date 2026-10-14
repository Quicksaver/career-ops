// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { detectCustomProvider, fetchCustomProvider } from './_custom.mjs';

/** @type {Provider} */
export default {
  id: 'englishjobs',
  detect(entry) {
    return detectCustomProvider('englishjobs', entry);
  },
  fetch(entry, ctx) {
    return fetchCustomProvider('englishjobs', entry, ctx);
  },
};
