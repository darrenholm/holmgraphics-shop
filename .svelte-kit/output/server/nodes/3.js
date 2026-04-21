

export const index = 3;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/admin/gallery-curate/_page.svelte.js')).default;
export const imports = ["_app/immutable/nodes/3.5ef85daa.js","_app/immutable/chunks/scheduler.84ee6664.js","_app/immutable/chunks/each.51738d15.js","_app/immutable/chunks/index.8673f6d5.js","_app/immutable/chunks/auth.1275aa0b.js","_app/immutable/chunks/singletons.5594e6ec.js","_app/immutable/chunks/index.73e54a38.js","_app/immutable/chunks/client.6e85d7a8.js"];
export const stylesheets = ["_app/immutable/assets/3.c4dda4af.css"];
export const fonts = [];
