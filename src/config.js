const fs = require('node:fs');
const path = require('node:path');

const CONFIG_PATH = path.join(__dirname, '..', 'db', 'terminal.json');

function leerConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return { ubicacion: null };
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function guardarConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

module.exports = { leerConfig, guardarConfig };
