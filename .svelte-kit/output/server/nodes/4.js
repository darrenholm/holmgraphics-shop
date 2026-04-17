

export const index = 4;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/jobs/new/_page.svelte.js')).default;
export const imports = ["_app/immutable/nodes/4.494c74ff.js","_app/immutable/chunks/scheduler.0e0485a9.js","_app/immutable/chunks/index.10bb342d.js","_app/immutable/chunks/each.49c147d7.js","_app/immutable/chunks/navigation.8a3a5f98.js","_app/immutable/chunks/singletons.215dbf34.js","_app/immutable/chunks/client.196059a0.js","_app/immutable/chunks/auth.f0c17bef.js"];
export const stylesheets = ["_app/immutable/assets/4.f9f75aea.css"];
export const fonts = [];
