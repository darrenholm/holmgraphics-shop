// print-bridge/uninstall-service.js
//
// Uninstalls the Windows service. Run from an elevated prompt:
//   npm run uninstall-service

const path = require('path');
let Service;
try { Service = require('node-windows').Service; }
catch (e) {
  console.error('node-windows is not installed.');
  process.exit(1);
}

const svc = new Service({
  name: 'HolmGraphics Print Bridge',
  script: path.join(__dirname, 'server.js')
});

svc.on('uninstall', () => console.log('[uninstall-service] Service uninstalled.'));
svc.uninstall();
