// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { detectCustomProvider, fetchCustomProvider } from './_custom.mjs';

/** @type {Provider} */
export default {
  id: 'landingjobs',
  detect(entry) {
    return detectCustomProvider('landingjobs', entry);
  },
  fetch(entry) {
    return fetchCustomProvider('landingjobs', entry);
  },
};
