

export const index = 2;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/_page.svelte.js')).default;
export const imports = ["_app/immutable/nodes/2.f2931064.js","_app/immutable/chunks/scheduler.0e0485a9.js","_app/immutable/chunks/index.10bb342d.js","_app/immutable/chunks/navigation.8a3a5f98.js","_app/immutable/chunks/singletons.215dbf34.js","_app/immutable/chunks/auth.f0c17bef.js"];
export const stylesheets = [];
export const fonts = [];
