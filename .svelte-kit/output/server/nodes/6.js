import * as universal from '../entries/pages/login/_page.js';

export const index = 6;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/login/_page.svelte.js')).default;
export { universal };
export const universal_id = "src/routes/login/+page.js";
export const imports = ["_app/immutable/nodes/6.6e504e4d.js","_app/immutable/chunks/scheduler.0e0485a9.js","_app/immutable/chunks/index.10bb342d.js","_app/immutable/chunks/each.49c147d7.js","_app/immutable/chunks/navigation.8a3a5f98.js","_app/immutable/chunks/singletons.215dbf34.js","_app/immutable/chunks/auth.f0c17bef.js","_app/immutable/chunks/client.196059a0.js"];
export const stylesheets = ["_app/immutable/assets/6.91e49704.css"];
export const fonts = [];
