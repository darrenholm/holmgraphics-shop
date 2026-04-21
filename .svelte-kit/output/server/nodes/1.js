

export const index = 1;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/fallbacks/error.svelte.js')).default;
export const imports = ["_app/immutable/nodes/1.969cc585.js","_app/immutable/chunks/scheduler.84ee6664.js","_app/immutable/chunks/index.8673f6d5.js","_app/immutable/chunks/stores.0e8e3d40.js","_app/immutable/chunks/singletons.5594e6ec.js","_app/immutable/chunks/index.73e54a38.js"];
export const stylesheets = [];
export const fonts = [];
