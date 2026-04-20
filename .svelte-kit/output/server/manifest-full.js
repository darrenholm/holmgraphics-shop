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
		client: {"start":"_app/immutable/entry/start.534d7245.js","app":"_app/immutable/entry/app.87bb3378.js","imports":["_app/immutable/entry/start.534d7245.js","_app/immutable/chunks/scheduler.84ee6664.js","_app/immutable/chunks/singletons.9791a815.js","_app/immutable/chunks/index.73e54a38.js","_app/immutable/entry/app.87bb3378.js","_app/immutable/chunks/preload-helper.a4192956.js","_app/immutable/chunks/scheduler.84ee6664.js","_app/immutable/chunks/index.8673f6d5.js"],"stylesheets":[],"fonts":[]},
		nodes: [
			__memo(() => import('./nodes/0.js')),
			__memo(() => import('./nodes/1.js')),
			__memo(() => import('./nodes/2.js')),
			__memo(() => import('./nodes/3.js')),
			__memo(() => import('./nodes/4.js')),
			__memo(() => import('./nodes/5.js')),
			__memo(() => import('./nodes/6.js')),
			__memo(() => import('./nodes/7.js')),
			__memo(() => import('./nodes/8.js')),
			__memo(() => import('./nodes/9.js')),
			__memo(() => import('./nodes/10.js')),
			__memo(() => import('./nodes/11.js')),
			__memo(() => import('./nodes/12.js'))
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
				id: "/admin/gallery-curate",
				pattern: /^\/admin\/gallery-curate\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 3 },
				endpoint: null
			},
			{
				id: "/dashboard",
				pattern: /^\/dashboard\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 4 },
				endpoint: null
			},
			{
				id: "/jobs/new",
				pattern: /^\/jobs\/new\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 5 },
				endpoint: null
			},
			{
				id: "/jobs/[id]",
				pattern: /^\/jobs\/([^/]+?)\/?$/,
				params: [{"name":"id","optional":false,"rest":false,"chained":false}],
				page: { layouts: [0,], errors: [1,], leaf: 6 },
				endpoint: null
			},
			{
				id: "/login",
				pattern: /^\/login\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 7 },
				endpoint: null
			},
			{
				id: "/profile",
				pattern: /^\/profile\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 8 },
				endpoint: null
			},
			{
				id: "/shop",
				pattern: /^\/shop\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 9 },
				endpoint: null
			},
			{
				id: "/shop/quote",
				pattern: /^\/shop\/quote\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 10 },
				endpoint: null
			},
			{
				id: "/shop/[supplier]/[style]",
				pattern: /^\/shop\/([^/]+?)\/([^/]+?)\/?$/,
				params: [{"name":"supplier","optional":false,"rest":false,"chained":false},{"name":"style","optional":false,"rest":false,"chained":false}],
				page: { layouts: [0,], errors: [1,], leaf: 11 },
				endpoint: null
			},
			{
				id: "/upload",
				pattern: /^\/upload\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 12 },
				endpoint: null
			}
		],
		matchers: async () => {
			
			return {  };
		}
	}
}
})();
