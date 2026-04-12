

export const index = 2;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/_page.svelte.js')).default;
export const imports = ["_app/immutable/nodes/2.cb8c8ac1.js","_app/immutable/chunks/scheduler.0e0485a9.js","_app/immutable/chunks/index.1f5b795e.js","_app/immutable/chunks/navigation.354cd70d.js","_app/immutable/chunks/singletons.aa4588bf.js","_app/immutable/chunks/auth.51edb327.js"];
export const stylesheets = [];
export const fonts = [];
