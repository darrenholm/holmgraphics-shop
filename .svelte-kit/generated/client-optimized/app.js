export { matchers } from './matchers.js';

export const nodes = [
	() => import('./nodes/0'),
	() => import('./nodes/1'),
	() => import('./nodes/2'),
	() => import('./nodes/3'),
	() => import('./nodes/4'),
	() => import('./nodes/5'),
	() => import('./nodes/6'),
	() => import('./nodes/7'),
	() => import('./nodes/8'),
	() => import('./nodes/9'),
	() => import('./nodes/10'),
	() => import('./nodes/11'),
	() => import('./nodes/12')
];

export const server_loads = [];

export const dictionary = {
		"/": [2],
		"/admin/gallery-curate": [3],
		"/dashboard": [4],
		"/jobs/new": [5],
		"/jobs/[id]": [6],
		"/login": [7],
		"/profile": [8],
		"/shop": [9],
		"/shop/quote": [10],
		"/shop/[supplier]/[style]": [11],
		"/upload": [12]
	};

export const hooks = {
	handleError: (({ error }) => { console.error(error) }),
};

export { default as root } from '../root.svelte';