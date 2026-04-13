

export const index = 2;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/_page.svelte.js')).default;
export const imports = ["_app/immutable/nodes/2.bd0ecf27.js","_app/immutable/chunks/scheduler.0e0485a9.js","_app/immutable/chunks/index.1f5b795e.js","_app/immutable/chunks/navigation.36bfbda6.js","_app/immutable/chunks/singletons.ce1d4782.js","_app/immutable/chunks/auth.0517d0dd.js"];
export const stylesheets = [];
export const fonts = [];
