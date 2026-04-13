

export const index = 6;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/login/_page.svelte.js')).default;
export const imports = ["_app/immutable/nodes/6.5460c4b6.js","_app/immutable/chunks/scheduler.0e0485a9.js","_app/immutable/chunks/index.1f5b795e.js","_app/immutable/chunks/each.0fc0a765.js","_app/immutable/chunks/navigation.36bfbda6.js","_app/immutable/chunks/singletons.ce1d4782.js","_app/immutable/chunks/auth.0517d0dd.js","_app/immutable/chunks/client.4d5574c4.js"];
export const stylesheets = ["_app/immutable/assets/6.91e49704.css"];
export const fonts = [];
