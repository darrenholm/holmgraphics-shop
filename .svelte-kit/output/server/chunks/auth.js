import { d as derived, w as writable } from "./index.js";
function createAuthStore() {
  let initial = null;
  if (typeof localStorage !== "undefined") {
    try {
      const stored = localStorage.getItem("hg_user");
      if (stored)
        initial = JSON.parse(stored);
    } catch {
    }
  }
  const { subscribe, set, update } = writable(initial);
  return {
    subscribe,
    login(user, token) {
      localStorage.setItem("hg_token", token);
      localStorage.setItem("hg_user", JSON.stringify(user));
      set(user);
    },
    logout() {
      localStorage.removeItem("hg_token");
      localStorage.removeItem("hg_user");
      set(null);
    }
  };
}
const auth = createAuthStore();
derived(auth, ($auth) => !!$auth);
const isStaff = derived(auth, ($auth) => $auth?.role === "staff" || $auth?.role === "admin");
derived(auth, ($auth) => $auth?.role === "admin");
derived(auth, ($auth) => $auth?.role === "client");
export {
  auth as a,
  isStaff as i
};
