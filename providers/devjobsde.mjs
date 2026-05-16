// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { detectCustomProvider, fetchCustomProvider } from './_custom.mjs';

/** @type {Provider} */
export default {
  id: 'devjobsde',
  detect(entry) {
    return detectCustomProvider('devjobsde', entry);
  },
  fetch(entry) {
    return fetchCustomProvider('devjobsde', entry);
  },
};
