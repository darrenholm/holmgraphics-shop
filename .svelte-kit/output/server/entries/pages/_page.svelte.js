import { c as create_ssr_component, a as subscribe } from "../../chunks/ssr.js";
import { a as auth } from "../../chunks/auth.js";
const Page = create_ssr_component(($$result, $$props, $$bindings, slots) => {
  let $$unsubscribe_auth;
  $$unsubscribe_auth = subscribe(auth, (value) => value);
  $$unsubscribe_auth();
  return ``;
});
export {
  Page as default
};
