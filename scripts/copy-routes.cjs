const fs = require('fs');
const path = require('path');

const routes = ['login', 'dashboard', 'upload', 'profile', 'jobs/new'];
const src = path.join(__dirname, '../build/index.html');

routes.forEach(route => {
  const dir = path.join(__dirname, '../build', route);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(src, path.join(dir, 'index.html'));
  console.log(`Created build/${route}/index.html`);
});