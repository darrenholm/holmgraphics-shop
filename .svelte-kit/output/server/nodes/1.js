

export const index = 1;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/fallbacks/error.svelte.js')).default;
export const imports = ["_app/immutable/nodes/1.06ee8c51.js","_app/immutable/chunks/scheduler.0e0485a9.js","_app/immutable/chunks/index.1f5b795e.js","_app/immutable/chunks/stores.dc011ee6.js","_app/immutable/chunks/singletons.ce1d4782.js"];
export const stylesheets = [];
export const fonts = [];
