

export const index = 1;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/fallbacks/error.svelte.js')).default;
export const imports = ["_app/immutable/nodes/1.64f83c13.js","_app/immutable/chunks/scheduler.84ee6664.js","_app/immutable/chunks/index.8673f6d5.js","_app/immutable/chunks/stores.31820bb3.js","_app/immutable/chunks/singletons.9791a815.js","_app/immutable/chunks/index.73e54a38.js"];
export const stylesheets = [];
export const fonts = [];
