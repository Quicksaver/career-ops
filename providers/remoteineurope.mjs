// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { detectCustomProvider, fetchCustomProvider } from './_custom.mjs';

/** @type {Provider} */
export default {
  id: 'remoteineurope',
  detect(entry) {
    return detectCustomProvider('remoteineurope', entry);
  },
  fetch(entry) {
    return fetchCustomProvider('remoteineurope', entry);
  },
};
