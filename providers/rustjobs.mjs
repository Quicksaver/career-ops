// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { detectCustomProvider, fetchCustomProvider } from './_custom.mjs';

/** @type {Provider} */
export default {
  id: 'rustjobs',
  detect(entry) {
    return detectCustomProvider('rustjobs', entry);
  },
  fetch(entry) {
    return fetchCustomProvider('rustjobs', entry);
  },
};
