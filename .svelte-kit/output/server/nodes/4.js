

export const index = 4;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/jobs/new/_page.svelte.js')).default;
export const imports = ["_app/immutable/nodes/4.2dd466b3.js","_app/immutable/chunks/scheduler.0e0485a9.js","_app/immutable/chunks/index.1f5b795e.js","_app/immutable/chunks/client.0f822a05.js","_app/immutable/chunks/navigation.44417fbc.js","_app/immutable/chunks/singletons.da1c3754.js","_app/immutable/chunks/auth.30012dac.js"];
export const stylesheets = ["_app/immutable/assets/4.f9f75aea.css"];
export const fonts = [];
