// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { detectCustomProvider, fetchCustomProvider } from './_custom.mjs';

/** @type {Provider} */
export default {
  id: 'euremotejobs',
  detect(entry) {
    return detectCustomProvider('euremotejobs', entry);
  },
  fetch(entry) {
    return fetchCustomProvider('euremotejobs', entry);
  },
};
