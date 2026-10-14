// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { detectCustomProvider, fetchCustomProvider } from './_custom.mjs';

/** @type {Provider} */
export default {
  id: 'jobsch',
  detect(entry) {
    return detectCustomProvider('jobsch', entry);
  },
  fetch(entry, ctx) {
    return fetchCustomProvider('jobsch', entry, ctx);
  },
};
