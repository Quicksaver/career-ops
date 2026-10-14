// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { detectCustomProvider, fetchCustomProvider } from './_custom.mjs';

/** @type {Provider} */
export default {
  id: 'sapo',
  detect(entry) {
    return detectCustomProvider('sapo', entry);
  },
  fetch(entry, ctx) {
    return fetchCustomProvider('sapo', entry, ctx);
  },
};
