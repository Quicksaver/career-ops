// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { detectCustomProvider, fetchCustomProvider } from './_custom.mjs';

/** @type {Provider} */
export default {
  id: 'pcsx',
  detect(entry) {
    return detectCustomProvider('pcsx', entry);
  },
  fetch(entry, ctx) {
    return fetchCustomProvider('pcsx', entry, ctx);
  },
};
