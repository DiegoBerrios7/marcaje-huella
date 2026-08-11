# Marcaje de Asistencia — Sala de Ventas

Prototipo funcional para que el personal de ventas marque su llegada con huella digital, quedando la marca automáticamente asociada a la sala de ventas donde está instalada la terminal.

## Cómo funciona

- Cada terminal (tablet o PC en la entrada de la sala de ventas) se configura **una sola vez** con el nombre de esa sala de ventas (pestaña "Config. Terminal"). Como el marcaje solo puede hacerse desde esa terminal física, la ubicación queda garantizada sin necesitar GPS.
- La huella se valida con **WebAuthn**, el estándar que usan Windows Hello y los sensores de huella de Android/Chrome — no requiere SDK de ningún fabricante, usa el sensor que ya trae el dispositivo.
- Cada vendedor se registra una vez (nombre + documento) y enrola su huella. Luego, para marcar entrada, solo escribe su documento y coloca el dedo.

## Requisitos

- Node.js 22.5 o superior (usa el módulo `node:sqlite` incluido en Node, así no hace falta compilar nada).
- Un dispositivo con sensor de huella habilitado como "método de inicio de sesión" del sistema operativo (Windows Hello, huella de Android, Touch ID en modo compatible) — WebAuthn usa ese sensor.
- Para producción, servir la app por **HTTPS** (o `localhost`, que los navegadores tratan como contexto seguro). WebAuthn no funciona sobre HTTP plano en una IP/dominio real.

## Instalación y uso

```bash
cd marcaje-huella
npm install
npm start
```

Abre `http://localhost:3000` en el navegador de la terminal.

1. **Config. Terminal**: escribe el nombre de la sala de ventas y guarda (una sola vez por terminal).
2. **Empleados**: da de alta a cada vendedor y presiona "Enrolar huella" — el navegador pedirá confirmar con el sensor de huella del dispositivo.
3. **Marcaje**: pantalla principal para el día a día — el vendedor escribe su documento y toca "Marcar con huella".
4. **Reporte**: lista de marcajes recientes con fecha, hora, empleado y sala de ventas.

## Notas para llevarlo a producción real

- Publicar detrás de HTTPS con un dominio fijo (ajustar `RP_ID` y `ORIGIN` en `src/server.js`).
- Si vas a tener varias salas de venta, cada una necesita su propia terminal configurada con su propio nombre — los datos ya quedan separados por `ubicacion` en la tabla `marcajes`.
- Agregar autenticación de administrador para las pestañas de Empleados/Config, hoy son de acceso libre (prototipo).
- La base de datos vive en `db/marcaje.sqlite` (SQLite, un solo archivo — fácil de respaldar).
