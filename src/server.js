const express = require('express');
const path = require('node:path');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

const db = require('./db');
const { leerConfig, guardarConfig } = require('./config');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const PORT = process.env.PORT || 3000;
const RP_NAME = 'Marcaje Sala de Ventas';
const RP_ID = process.env.RP_ID || 'localhost';
const ORIGIN = process.env.ORIGIN || `http://localhost:${PORT}`;

// Retos WebAuthn en curso (memoria, suficiente para un prototipo de una sola terminal)
const retosRegistro = new Map(); // empleadoId -> challenge
const retosAutenticacion = new Map(); // documento -> { challenge, empleadoId }

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

// ---------- Configuración de la terminal (ubicación / sala de venta) ----------

app.get('/api/config', (req, res) => {
  res.json(leerConfig());
});

app.post('/api/config', (req, res) => {
  const { ubicacion } = req.body;
  if (!ubicacion || !ubicacion.trim()) {
    return res.status(400).json({ error: 'Debes indicar el nombre de la sala de ventas.' });
  }
  guardarConfig({ ubicacion: ubicacion.trim() });
  res.json({ ok: true });
});

// ---------- Empleados ----------

app.get('/api/empleados', (req, res) => {
  const empleados = db.prepare(`
    SELECT e.id, e.nombre, e.documento,
      (SELECT COUNT(*) FROM credenciales c WHERE c.empleado_id = e.id) AS huellas_registradas
    FROM empleados e ORDER BY e.nombre
  `).all();
  res.json(empleados);
});

app.post('/api/empleados', (req, res) => {
  const { nombre, documento } = req.body;
  if (!nombre?.trim() || !documento?.trim()) {
    return res.status(400).json({ error: 'Nombre y documento son requeridos.' });
  }
  try {
    const info = db.prepare('INSERT INTO empleados (nombre, documento) VALUES (?, ?)')
      .run(nombre.trim(), documento.trim());
    res.json({ id: info.lastInsertRowid, nombre: nombre.trim(), documento: documento.trim() });
  } catch (e) {
    res.status(400).json({ error: 'Ya existe un empleado con ese documento.' });
  }
});

app.delete('/api/empleados/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM credenciales WHERE empleado_id = ?').run(id);
  db.prepare('DELETE FROM marcajes WHERE empleado_id = ?').run(id);
  db.prepare('DELETE FROM empleados WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---------- Enrolamiento de huella (registro WebAuthn) ----------

app.post('/api/empleados/:id/huella/opciones', async (req, res) => {
  const id = Number(req.params.id);
  const empleado = db.prepare('SELECT * FROM empleados WHERE id = ?').get(id);
  if (!empleado) return res.status(404).json({ error: 'Empleado no encontrado.' });

  const credenciales = db.prepare('SELECT credential_id FROM credenciales WHERE empleado_id = ?').all(id);

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: empleado.documento,
    userDisplayName: empleado.nombre,
    attestationType: 'none',
    excludeCredentials: credenciales.map(c => ({ id: c.credential_id })),
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: 'required',
      residentKey: 'preferred',
    },
  });

  retosRegistro.set(id, options.challenge);
  res.json(options);
});

app.post('/api/empleados/:id/huella/verificar', async (req, res) => {
  const id = Number(req.params.id);
  const empleado = db.prepare('SELECT * FROM empleados WHERE id = ?').get(id);
  if (!empleado) return res.status(404).json({ error: 'Empleado no encontrado.' });

  const expectedChallenge = retosRegistro.get(id);
  if (!expectedChallenge) return res.status(400).json({ error: 'No hay un registro de huella en curso.' });

  try {
    const verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'No se pudo verificar la huella.' });
    }

    const { credential } = verification.registrationInfo;
    db.prepare('INSERT INTO credenciales (empleado_id, credential_id, public_key, counter) VALUES (?, ?, ?, ?)')
      .run(id, credential.id, base64url(credential.publicKey), credential.counter);

    retosRegistro.delete(id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- Marcaje (autenticación WebAuthn = validación de huella) ----------

app.post('/api/marcaje/opciones', async (req, res) => {
  const { documento } = req.body;
  const empleado = db.prepare('SELECT * FROM empleados WHERE documento = ?').get(documento?.trim());
  if (!empleado) return res.status(404).json({ error: 'No existe un empleado con ese documento.' });

  const credenciales = db.prepare('SELECT credential_id FROM credenciales WHERE empleado_id = ?').all(empleado.id);
  if (credenciales.length === 0) {
    return res.status(400).json({ error: 'Este empleado no tiene huella registrada todavía.' });
  }

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'required',
    allowCredentials: credenciales.map(c => ({ id: c.credential_id })),
  });

  retosAutenticacion.set(documento.trim(), { challenge: options.challenge, empleadoId: empleado.id });
  res.json(options);
});

app.post('/api/marcaje/verificar', async (req, res) => {
  const { documento, respuesta } = req.body;
  const pendiente = retosAutenticacion.get(documento?.trim());
  if (!pendiente) return res.status(400).json({ error: 'No hay un marcaje en curso para este empleado.' });

  const cred = db.prepare('SELECT * FROM credenciales WHERE empleado_id = ? AND credential_id = ?')
    .get(pendiente.empleadoId, respuesta.id);
  if (!cred) return res.status(400).json({ error: 'Credencial no reconocida.' });

  const config = leerConfig();
  if (!config.ubicacion) {
    return res.status(400).json({ error: 'Esta terminal aún no tiene configurada su sala de ventas.' });
  }

  try {
    const verification = await verifyAuthenticationResponse({
      response: respuesta,
      expectedChallenge: pendiente.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: cred.credential_id,
        publicKey: Buffer.from(cred.public_key, 'base64url'),
        counter: cred.counter,
      },
    });

    if (!verification.verified) {
      return res.status(400).json({ error: 'La huella no pudo ser verificada.' });
    }

    db.prepare('UPDATE credenciales SET counter = ? WHERE id = ?')
      .run(verification.authenticationInfo.newCounter, cred.id);

    const empleado = db.prepare('SELECT * FROM empleados WHERE id = ?').get(pendiente.empleadoId);
    db.prepare('INSERT INTO marcajes (empleado_id, ubicacion) VALUES (?, ?)')
      .run(pendiente.empleadoId, config.ubicacion);

    retosAutenticacion.delete(documento.trim());
    res.json({ ok: true, nombre: empleado.nombre, ubicacion: config.ubicacion });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- Reporte de asistencia ----------

app.get('/api/reporte', (req, res) => {
  const marcajes = db.prepare(`
    SELECT m.id, e.nombre, e.documento, m.ubicacion, m.fecha_hora
    FROM marcajes m JOIN empleados e ON e.id = m.empleado_id
    ORDER BY m.fecha_hora DESC
    LIMIT 200
  `).all();
  res.json(marcajes);
});

app.listen(PORT, () => {
  console.log(`Marcaje de huella corriendo en ${ORIGIN}`);
});
