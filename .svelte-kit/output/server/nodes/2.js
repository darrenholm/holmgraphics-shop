

export const index = 2;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/_page.svelte.js')).default;
export const imports = ["_app/immutable/nodes/2.eed35599.js","_app/immutable/chunks/scheduler.84ee6664.js","_app/immutable/chunks/index.8673f6d5.js","_app/immutable/chunks/auth.1275aa0b.js","_app/immutable/chunks/singletons.5594e6ec.js","_app/immutable/chunks/index.73e54a38.js"];
export const stylesheets = [];
export const fonts = [];
