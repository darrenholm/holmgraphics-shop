import * as universal from '../entries/pages/dashboard/_page.js';

export const index = 4;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/dashboard/_page.svelte.js')).default;
export { universal };
export const universal_id = "src/routes/dashboard/+page.js";
export const imports = ["_app/immutable/nodes/4.258f61ed.js","_app/immutable/chunks/scheduler.84ee6664.js","_app/immutable/chunks/each.51738d15.js","_app/immutable/chunks/index.8673f6d5.js","_app/immutable/chunks/auth.1275aa0b.js","_app/immutable/chunks/singletons.5594e6ec.js","_app/immutable/chunks/index.73e54a38.js","_app/immutable/chunks/client.6e85d7a8.js"];
export const stylesheets = ["_app/immutable/assets/4.cf6d9df5.css"];
export const fonts = [];
