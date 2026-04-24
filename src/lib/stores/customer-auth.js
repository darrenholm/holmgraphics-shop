// src/lib/stores/customer-auth.js
//
// Online-customer auth store. Distinct from the staff auth store at
// $lib/stores/auth.js — different localStorage keys (`hg_customer_token`
// and `hg_customer`) so a Holm Graphics employee can be logged into the
// staff dashboard AND simultaneously test the customer experience in the
// same browser without sessions clobbering each other.

import { writable, derived } from 'svelte/store';

const TOKEN_KEY   = 'hg_customer_token';
const PROFILE_KEY = 'hg_customer';

function createCustomerAuthStore() {
  let initial = null;
  if (typeof localStorage !== 'undefined') {
    try {
      const stored = localStorage.getItem(PROFILE_KEY);
      if (stored) initial = JSON.parse(stored);
    } catch {}
  }

  const { subscribe, set } = writable(initial);

  return {
    subscribe,
    login(profile, token) {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      set(profile);
    },
    update(profile) {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      set(profile);
    },
    logout() {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(PROFILE_KEY);
      set(null);
    },
  };
}

export const customer = createCustomerAuthStore();
export const isCustomerLoggedIn = derived(customer, ($c) => !!$c);
