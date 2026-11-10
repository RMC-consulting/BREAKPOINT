# RMC Breaking Point

Landing de una sola página de RMC Breaking Point, la línea de Rocha Mendoza Consulting para el desarrollo de personas y equipos. Incluye la prueba de 60 segundos, la calculadora del costo de no hacer nada, los cinco servicios, cómo trabajamos, equipo y certificaciones, preguntas frecuentes, contacto y redes sociales (LinkedIn, YouTube y WhatsApp). Los administradores pueden editar textos, enlaces, fotos y video desde la propia página.

- Node 18 o superior. No tiene dependencias externas.
- Los textos editados y los archivos subidos se guardan en la carpeta `DATA_DIR` (`content.json` y `uploads/`).

## Estructura

```
server.js          Servidor (páginas, API de edición y subida de archivos)
public/index.html  El sitio completo (diseño, contenido por defecto y editor)
public/favicon.svg Ícono de la pestaña
render.yaml        Configuración para desplegar en Render
```

## Probar en su computadora

```bash
ADMIN_PASSWORD=una-clave-segura npm start
```

En Windows (PowerShell):

```powershell
$env:ADMIN_PASSWORD="una-clave-segura"; npm start
```

Abra http://localhost:3000. Al pie de la página está **Acceso administrador**: entre con la contraseña y se activa el modo edición.

## Subir a GitHub

1. Cree un repositorio nuevo en GitHub (por ejemplo `rmc-capacitacion`).
2. Suba el contenido de esta carpeta: arrastre los archivos en la web de GitHub, o desde la terminal:

```bash
git init
git add .
git commit -m "Sitio RMC Capacitación"
git branch -M main
git remote add origin https://github.com/SU-USUARIO/rmc-capacitacion.git
git push -u origin main
```

## Publicar en Render

**Opción A, con Blueprint (usa `render.yaml`):**

1. En Render: **New → Blueprint** y elija el repositorio.
2. Render pedirá el valor de `ADMIN_PASSWORD`: escriba la contraseña para editar.
3. Confirme. Se crea el servicio con un disco de 1 GB en `/var/data` para guardar imágenes, videos y textos.

**Opción B, manual:**

1. **New → Web Service** y elija el repositorio.
2. Build command: `npm install`. Start command: `npm start`.
3. En **Environment** agregue `ADMIN_PASSWORD` y `DATA_DIR=/var/data`.
4. En **Disks** agregue un disco montado en `/var/data`.

### Importante sobre el almacenamiento

Los discos persistentes de Render requieren un plan de pago (Starter o superior). En el plan gratuito el sitio funciona, pero **todo lo que se suba o edite se borra** cada vez que el servicio se reinicia o se vuelve a desplegar. Para el plan gratuito quite el bloque `disk:` y `DATA_DIR` de `render.yaml`; úselo solo para revisar el diseño.

## Variables de entorno

| Variable | Para qué sirve | Valor por defecto |
|---|---|---|
| `ADMIN_PASSWORD` | Contraseña del modo edición. Sin ella nadie puede editar. | (vacía) |
| `DATA_DIR` | Carpeta donde se guardan textos y archivos | `./data` |
| `MAX_UPLOAD_MB` | Tamaño máximo por archivo | `50` |
| `PORT` | Puerto (Render lo asigna) | `3000` |

Si cambia `MAX_UPLOAD_MB`, cambie también `MAX_MB` en `public/index.html` para que los mensajes coincidan.

## Editar el contenido

- **Desde la página:** con sesión de administrador, haga clic en cualquier texto con borde punteado para cambiarlo. En cada espacio de imagen use **Subir imagen o video** o arrastre el archivo. Formatos: JPG, PNG, WebP, GIF, MP4 y WebM.
- **Enlaces:** en modo edición aparece una barra con los campos de la página de contacto de RMC, LinkedIn, YouTube y el número de WhatsApp (con lada de país, solo dígitos, por ejemplo `5215512345678`).
- **Desde el código:** los textos por defecto están en el objeto `DEF` y los enlaces en `DEFAULT_LINKS` de `public/index.html`. Lo editado desde la página tiene prioridad.

## Pendientes de contenido

Los textos entre corchetes vienen así en el material original y hay que reemplazarlos: cifras (`[XX]`), nombres y experiencia de los socios, testimonio, correo, teléfono y número de sesiones al mes. También hay que poner los enlaces reales de LinkedIn, YouTube, WhatsApp y la página de contacto.
