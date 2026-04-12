// src/lib/stores/auth.js
import { writable, derived } from 'svelte/store';

function createAuthStore() {
  let initial = null;
  if (typeof localStorage !== 'undefined') {
    try {
      const stored = localStorage.getItem('hg_user');
      if (stored) initial = JSON.parse(stored);
    } catch {}
  }

  const { subscribe, set, update } = writable(initial);

  return {
    subscribe,
    login(user, token) {
      localStorage.setItem('hg_token', token);
      localStorage.setItem('hg_user', JSON.stringify(user));
      set(user);
    },
    logout() {
      localStorage.removeItem('hg_token');
      localStorage.removeItem('hg_user');
      set(null);
    }
  };
}

export const auth = createAuthStore();
export const isLoggedIn = derived(auth, ($auth) => !!$auth);
export const isStaff = derived(auth, ($auth) => $auth?.role === 'staff' || $auth?.role === 'admin');
export const isAdmin = derived(auth, ($auth) => $auth?.role === 'admin');
export const isClient = derived(auth, ($auth) => $auth?.role === 'client');
