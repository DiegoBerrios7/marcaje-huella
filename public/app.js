// ---------- Helpers WebAuthn (base64url <-> ArrayBuffer) ----------

function base64urlToBuffer(base64url) {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const buffer = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buffer[i] = raw.charCodeAt(i);
  return buffer.buffer;
}

function bufferToBase64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function iniciarRegistroWebAuthn(options) {
  const publicKey = {
    ...options,
    challenge: base64urlToBuffer(options.challenge),
    user: { ...options.user, id: base64urlToBuffer(options.user.id) },
    excludeCredentials: (options.excludeCredentials || []).map(c => ({ ...c, id: base64urlToBuffer(c.id) })),
  };
  const credential = await navigator.credentials.create({ publicKey });
  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64url(credential.response.clientDataJSON),
      attestationObject: bufferToBase64url(credential.response.attestationObject),
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  };
}

async function iniciarAutenticacionWebAuthn(options) {
  const publicKey = {
    ...options,
    challenge: base64urlToBuffer(options.challenge),
    allowCredentials: (options.allowCredentials || []).map(c => ({ ...c, id: base64urlToBuffer(c.id) })),
  };
  const credential = await navigator.credentials.get({ publicKey });
  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64url(credential.response.clientDataJSON),
      authenticatorData: bufferToBase64url(credential.response.authenticatorData),
      signature: bufferToBase64url(credential.response.signature),
      userHandle: credential.response.userHandle ? bufferToBase64url(credential.response.userHandle) : null,
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  };
}

// ---------- Navegación de pestañas ----------

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('activo'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('activo'));
    btn.classList.add('activo');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('activo');
    if (btn.dataset.tab === 'empleados') cargarEmpleados();
    if (btn.dataset.tab === 'reporte') cargarReporte();
    if (btn.dataset.tab === 'marcaje') cargarUbicacion();
  });
});

function mostrarMensaje(el, texto, ok) {
  el.textContent = texto;
  el.className = 'mensaje ' + (ok ? 'ok' : 'error');
}

// ---------- Config terminal ----------

async function cargarUbicacion() {
  const res = await fetch('/api/config');
  const cfg = await res.json();
  const el = document.getElementById('ubicacion-actual');
  el.textContent = cfg.ubicacion ? `📍 ${cfg.ubicacion}` : '⚠️ Terminal sin configurar — ve a "Config. Terminal"';
}

document.getElementById('btn-guardar-config').addEventListener('click', async () => {
  const ubicacion = document.getElementById('config-ubicacion').value;
  const res = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ubicacion }),
  });
  const data = await res.json();
  const msg = document.getElementById('config-mensaje');
  if (res.ok) {
    mostrarMensaje(msg, 'Ubicación guardada correctamente.', true);
    cargarUbicacion();
  } else {
    mostrarMensaje(msg, data.error, false);
  }
});

// ---------- Empleados ----------

async function cargarEmpleados() {
  const res = await fetch('/api/empleados');
  const empleados = await res.json();
  const tbody = document.querySelector('#tabla-empleados tbody');
  tbody.innerHTML = '';
  for (const emp of empleados) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${emp.nombre}</td>
      <td>${emp.documento}</td>
      <td>${emp.huellas_registradas > 0 ? '✅ registrada' : '<button class="btn-enrolar">Enrolar huella</button>'}</td>
      <td><button class="btn-eliminar">Eliminar</button></td>
    `;
    const btnEnrolar = tr.querySelector('.btn-enrolar');
    if (btnEnrolar) btnEnrolar.addEventListener('click', () => enrolarHuella(emp.id));
    tr.querySelector('.btn-eliminar').addEventListener('click', () => eliminarEmpleado(emp.id));
    tbody.appendChild(tr);
  }
}

document.getElementById('btn-crear-empleado').addEventListener('click', async () => {
  const nombre = document.getElementById('emp-nombre').value;
  const documento = document.getElementById('emp-documento').value;
  const res = await fetch('/api/empleados', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre, documento }),
  });
  const data = await res.json();
  const msg = document.getElementById('empleados-mensaje');
  if (res.ok) {
    mostrarMensaje(msg, 'Empleado agregado.', true);
    document.getElementById('emp-nombre').value = '';
    document.getElementById('emp-documento').value = '';
    cargarEmpleados();
  } else {
    mostrarMensaje(msg, data.error, false);
  }
});

async function eliminarEmpleado(id) {
  await fetch(`/api/empleados/${id}`, { method: 'DELETE' });
  cargarEmpleados();
}

async function enrolarHuella(empleadoId) {
  const msg = document.getElementById('empleados-mensaje');
  try {
    const resOpc = await fetch(`/api/empleados/${empleadoId}/huella/opciones`, { method: 'POST' });
    const options = await resOpc.json();
    if (!resOpc.ok) throw new Error(options.error);

    mostrarMensaje(msg, 'Sigue las instrucciones del dispositivo para registrar la huella...', true);
    const credencial = await iniciarRegistroWebAuthn(options);

    const resVer = await fetch(`/api/empleados/${empleadoId}/huella/verificar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credencial),
    });
    const data = await resVer.json();
    if (!resVer.ok) throw new Error(data.error);

    mostrarMensaje(msg, 'Huella registrada correctamente.', true);
    cargarEmpleados();
  } catch (e) {
    mostrarMensaje(msg, 'Error al enrolar huella: ' + e.message, false);
  }
}

// ---------- Marcaje ----------

document.getElementById('btn-marcar').addEventListener('click', async () => {
  const msg = document.getElementById('marcaje-mensaje');
  const documento = document.getElementById('marcaje-documento').value.trim();
  if (!documento) return mostrarMensaje(msg, 'Ingresa tu número de documento.', false);

  try {
    const resOpc = await fetch('/api/marcaje/opciones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documento }),
    });
    const options = await resOpc.json();
    if (!resOpc.ok) throw new Error(options.error);

    mostrarMensaje(msg, 'Coloca tu dedo en el lector...', true);
    const respuesta = await iniciarAutenticacionWebAuthn(options);

    const resVer = await fetch('/api/marcaje/verificar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documento, respuesta }),
    });
    const data = await resVer.json();
    if (!resVer.ok) throw new Error(data.error);

    mostrarMensaje(msg, `✅ ¡Marcaje registrado, ${data.nombre}! (${data.ubicacion})`, true);
    document.getElementById('marcaje-documento').value = '';
  } catch (e) {
    mostrarMensaje(msg, 'Error: ' + e.message, false);
  }
});

// ---------- Reporte ----------

async function cargarReporte() {
  const res = await fetch('/api/reporte');
  const marcajes = await res.json();
  const tbody = document.querySelector('#tabla-reporte tbody');
  tbody.innerHTML = '';
  for (const m of marcajes) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${m.fecha_hora}</td><td>${m.nombre}</td><td>${m.documento}</td><td>${m.ubicacion}</td>`;
    tbody.appendChild(tr);
  }
}

// ---------- Inicio ----------

cargarUbicacion();
