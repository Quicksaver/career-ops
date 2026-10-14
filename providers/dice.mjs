// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { detectCustomProvider, fetchCustomProvider } from './_custom.mjs';

/** @type {Provider} */
export default {
  id: 'dice',
  detect(entry) {
    return detectCustomProvider('dice', entry);
  },
  fetch(entry, ctx) {
    return fetchCustomProvider('dice', entry, ctx);
  },
};
