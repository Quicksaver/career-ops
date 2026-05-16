// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { detectCustomProvider, fetchCustomProvider } from './_custom.mjs';

/** @type {Provider} */
export default {
  id: 'workingnomads',
  detect(entry) {
    return detectCustomProvider('workingnomads', entry);
  },
  fetch(entry) {
    return fetchCustomProvider('workingnomads', entry);
  },
};
