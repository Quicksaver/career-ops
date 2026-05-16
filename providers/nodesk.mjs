// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { detectCustomProvider, fetchCustomProvider } from './_custom.mjs';

/** @type {Provider} */
export default {
  id: 'nodesk',
  detect(entry) {
    return detectCustomProvider('nodesk', entry);
  },
  fetch(entry) {
    return fetchCustomProvider('nodesk', entry);
  },
};
