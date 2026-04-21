

export const index = 5;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/jobs/new/_page.svelte.js')).default;
export const imports = ["_app/immutable/nodes/5.6c85d6d9.js","_app/immutable/chunks/scheduler.84ee6664.js","_app/immutable/chunks/each.51738d15.js","_app/immutable/chunks/index.8673f6d5.js","_app/immutable/chunks/auth.1275aa0b.js","_app/immutable/chunks/singletons.5594e6ec.js","_app/immutable/chunks/index.73e54a38.js","_app/immutable/chunks/client.6e85d7a8.js","_app/immutable/chunks/filesBridgeClient.f794db3a.js"];
export const stylesheets = ["_app/immutable/assets/5.90a85e3a.css"];
export const fonts = [];
