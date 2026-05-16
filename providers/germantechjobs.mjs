// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { detectCustomProvider, fetchCustomProvider } from './_custom.mjs';

/** @type {Provider} */
export default {
  id: 'germantechjobs',
  detect(entry) {
    return detectCustomProvider('germantechjobs', entry);
  },
  fetch(entry) {
    return fetchCustomProvider('germantechjobs', entry);
  },
};
