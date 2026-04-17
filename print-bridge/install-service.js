// print-bridge/install-service.js
//
// Installs this print bridge as an auto-start Windows service.
// Run from an elevated (Administrator) Command Prompt:
//   npm run install-service
//
// Requires the optional dependency `node-windows`. If missing, install with:
//   npm install node-windows --no-save

const path = require('path');
let Service;
try { Service = require('node-windows').Service; }
catch (e) {
  console.error('node-windows is not installed. Run: npm install node-windows --no-save');
  process.exit(1);
}

const svc = new Service({
  name: 'HolmGraphics Print Bridge',
  description: 'Relays label-print requests from the Holm Graphics Shop web app to the local DYMO LabelWriter.',
  script: path.join(__dirname, 'server.js'),
  nodeOptions: [],
  workingDirectory: __dirname,
  allowServiceLogon: true
});

svc.on('install', () => {
  console.log('[install-service] Service installed. Starting…');
  svc.start();
});
svc.on('start',   () => console.log('[install-service] Service started.'));
svc.on('error',   (err) => console.error('[install-service] Error:', err));
svc.on('invalidinstallation', () => console.error('[install-service] Invalid installation.'));

svc.install();
