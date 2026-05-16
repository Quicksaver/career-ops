// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { detectCustomProvider, fetchCustomProvider } from './_custom.mjs';

/** @type {Provider} */
export default {
  id: 'jobsinenglish',
  detect(entry) {
    return detectCustomProvider('jobsinenglish', entry);
  },
  fetch(entry) {
    return fetchCustomProvider('jobsinenglish', entry);
  },
};
