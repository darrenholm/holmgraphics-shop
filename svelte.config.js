import adapter from '@sveltejs/adapter-static';
/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: 'index.html',
      precompress: false,
      strict: false
    }),
    prerender: {
      handleHttpError: ({ path, referrer, message }) => {
        if (path.includes('favicon')) return;
        throw new Error(message);
      },
      entries: ['*', '/login', '/dashboard', '/upload', '/profile', '/jobs/new']
    }
  }
};
export default config;