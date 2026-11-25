# TheFlow Capital — Vehículos (versión para Vercel)

Catálogo público + panel privado en un solo sitio.

- **Catálogo público:** lo que ven los clientes, con fotos deslizables, datos del vehículo y botón de WhatsApp.
- **Panel privado:** tu contabilidad (gastos, ganancia, 30 % del socio) y la ficha de cada vehículo. Se entra por el enlace "Acceso" al pie del catálogo, con tu contraseña.

## Qué hay en esta carpeta

| Archivo | Para qué sirve |
|---|---|
| `public/index.html` | La página completa en un solo archivo (diseño, logo y lógica) |
| `api/index.js` | El servidor: inicio de sesión, guardado de datos y subida de fotos |
| `package.json` | Lista de lo que Vercel debe instalar |

No hay que compilar nada: Vercel lo detecta solo.

## Paso a paso

1. **GitHub.** Crea una cuenta en github.com, crea un repositorio **privado** y sube los tres archivos respetando sus carpetas: `package.json` en la raíz, `api/index.js` y `public/index.html`.
2. **Vercel.** Entra en vercel.com con tu cuenta de GitHub. Para uso comercial corresponde el plan Pro.
3. **Importar.** "Add New… → Project", elige el repositorio y pulsa "Deploy". Deja "Framework Preset" en **Other** y no cambies nada más.
4. **Fotos (Blob).** En el proyecto: pestaña "Storage" → crear un almacén **Blob** con acceso **Public** → conectarlo al proyecto.
5. **Base de datos (Neon).** En "Storage" → Marketplace → **Neon** (Postgres) → instalar y conectar al proyecto. La tabla se crea sola la primera vez.
6. **Contraseña del panel.** "Settings → Environment Variables" → agrega:
   - `ADMIN_PASSWORD` = la contraseña con la que entrarás al panel (larga y que no uses en otro sitio).
   - `SESSION_SECRET` = cualquier texto largo al azar (opcional, recomendado).
7. **Redeploy.** Pestaña "Deployments" → menú del último despliegue → "Redeploy". Es obligatorio para que tome los pasos 4, 5 y 6.
8. **Comprobar.** Abre `https://TU-SITIO/api?r=estado`. Debe decir `"baseDeDatos":true,"fotos":true,"clave":true`. Lo que salga en `false` es lo que falta conectar.
9. **Entrar.** Abre tu sitio, baja al pie, pulsa "Acceso" y escribe tu contraseña.
10. **Dominio.** "Settings → Domains" → escribe tu dominio y sigue las instrucciones.

## Cómo funciona

- **Datos:** se guardan en Neon (Postgres), en una sola tabla llamada `tf_docs`.
- **Fotos:** se guardan en Vercel Blob como archivos JPG. La página las reduce a 1600 px antes de subirlas. Máximo 20 por vehículo.
- **Catálogo:** se arma en el servidor en cada visita, solo con los vehículos que tienen "Mostrar en el catálogo" encendido. Los cambios salen al instante.
- **Privacidad:** el servidor nunca envía al público gastos, precio de venta interno, ganancias, VIN ni datos del socio. Esos datos solo se entregan con la sesión del panel.
- **Sesión:** dura 30 días por dispositivo. Si cambias `ADMIN_PASSWORD`, todas las sesiones se cierran.

## Si algo falla

- **"El catálogo no está disponible":** falta la base de datos o el Redeploy (pasos 5 y 7).
- **"No se pudo subir la foto":** falta el almacén Blob, no es de acceso Public, o falta el Redeploy (pasos 4 y 7).
- **"Falta definir la contraseña":** falta `ADMIN_PASSWORD` o el Redeploy (pasos 6 y 7).
- Para ver el error exacto: en Vercel, pestaña "Logs" del proyecto.
