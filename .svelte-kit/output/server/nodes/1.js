

export const index = 1;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/fallbacks/error.svelte.js')).default;
export const imports = ["_app/immutable/nodes/1.4fb805bc.js","_app/immutable/chunks/scheduler.0e0485a9.js","_app/immutable/chunks/index.10bb342d.js","_app/immutable/chunks/stores.6beee63c.js","_app/immutable/chunks/singletons.215dbf34.js"];
export const stylesheets = [];
export const fonts = [];
