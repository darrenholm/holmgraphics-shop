

export const index = 3;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/dashboard/_page.svelte.js')).default;
export const imports = ["_app/immutable/nodes/3.ebdad967.js","_app/immutable/chunks/scheduler.0e0485a9.js","_app/immutable/chunks/index.1f5b795e.js","_app/immutable/chunks/client.0f822a05.js","_app/immutable/chunks/navigation.44417fbc.js","_app/immutable/chunks/singletons.da1c3754.js","_app/immutable/chunks/auth.30012dac.js"];
export const stylesheets = ["_app/immutable/assets/3.fb1d8dc4.css"];
export const fonts = [];
