

export const index = 3;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/dashboard/_page.svelte.js')).default;
export const imports = ["_app/immutable/nodes/3.5a1fdbdb.js","_app/immutable/chunks/scheduler.0e0485a9.js","_app/immutable/chunks/index.1f5b795e.js","_app/immutable/chunks/each.0fc0a765.js","_app/immutable/chunks/navigation.354cd70d.js","_app/immutable/chunks/singletons.aa4588bf.js","_app/immutable/chunks/client.4d5574c4.js","_app/immutable/chunks/auth.51edb327.js"];
export const stylesheets = ["_app/immutable/assets/3.fb1d8dc4.css"];
export const fonts = [];
