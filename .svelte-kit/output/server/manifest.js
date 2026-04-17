export const manifest = (() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	appDir: "_app",
	appPath: "_app",
	assets: new Set(["apple-touch-icon.png","files.zip","icon-192.png","icon-512.png","manifest.json","_redirects"]),
	mimeTypes: {".png":"image/png",".zip":"application/zip",".json":"application/json"},
	_: {
		client: {"start":"_app/immutable/entry/start.8031fb63.js","app":"_app/immutable/entry/app.5e6639ef.js","imports":["_app/immutable/entry/start.8031fb63.js","_app/immutable/chunks/scheduler.0e0485a9.js","_app/immutable/chunks/singletons.215dbf34.js","_app/immutable/entry/app.5e6639ef.js","_app/immutable/chunks/preload-helper.a4192956.js","_app/immutable/chunks/scheduler.0e0485a9.js","_app/immutable/chunks/index.10bb342d.js"],"stylesheets":[],"fonts":[]},
		nodes: [
			__memo(() => import('./nodes/0.js')),
			__memo(() => import('./nodes/1.js')),
			__memo(() => import('./nodes/2.js')),
			__memo(() => import('./nodes/4.js')),
			__memo(() => import('./nodes/5.js')),
			__memo(() => import('./nodes/8.js'))
		],
		routes: [
			{
				id: "/",
				pattern: /^\/$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 2 },
				endpoint: null
			},
			{
				id: "/jobs/new",
				pattern: /^\/jobs\/new\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 3 },
				endpoint: null
			},
			{
				id: "/jobs/[id]",
				pattern: /^\/jobs\/([^/]+?)\/?$/,
				params: [{"name":"id","optional":false,"rest":false,"chained":false}],
				page: { layouts: [0,], errors: [1,], leaf: 4 },
				endpoint: null
			},
			{
				id: "/upload",
				pattern: /^\/upload\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 5 },
				endpoint: null
			}
		],
		matchers: async () => {
			
			return {  };
		}
	}
}
})();
