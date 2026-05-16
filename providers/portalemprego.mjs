// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { detectCustomProvider, fetchCustomProvider } from './_custom.mjs';

/** @type {Provider} */
export default {
  id: 'portalemprego',
  detect(entry) {
    return detectCustomProvider('portalemprego', entry);
  },
  fetch(entry) {
    return fetchCustomProvider('portalemprego', entry);
  },
};
