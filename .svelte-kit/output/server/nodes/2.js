

export const index = 2;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/_page.svelte.js')).default;
export const imports = ["_app/immutable/nodes/2.a754e51d.js","_app/immutable/chunks/scheduler.84ee6664.js","_app/immutable/chunks/index.8673f6d5.js","_app/immutable/chunks/auth.5c6d2b56.js","_app/immutable/chunks/singletons.9791a815.js","_app/immutable/chunks/index.73e54a38.js"];
export const stylesheets = [];
export const fonts = [];
