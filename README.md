# SENDIX (v9, comentado)
- **index.html** explica la estructura de vistas y el flujo.
- **styles.css** contiene comentarios extensos por sección (tokens, cards, botones, chat, tracking, tabs).
- **app.js** incluye un encabezado que describe la arquitectura y responsabilidades.

## React integrado (opcional, sin build)

Se agregó un widget React de ejemplo montado en la vista Home usando CDN (React 18 + ReactDOM 18 + Babel standalone). Archivos relevantes:

- `index.html`: incluye los scripts UMD de React/ReactDOM y Babel, y un contenedor `#react-widget`.
- `react-app.jsx`: componente de ejemplo que lee el rol desde `localStorage` y muestra la hora, con un par de acciones.

Cómo probar:

1. Serví la carpeta con cualquier servidor estático (necesario para que los módulos carguen por HTTP):
	- Con Python 3: `python3 -m http.server 8080`
	- O con Node (si tienes `serve`): `npx serve -l 8080`
2. Abre `http://localhost:8080/` y loguéate; verás el bloque "Widget React" en Home.

Notas:
- Esta modalidad (Babel en el navegador) es útil para prototipos. Para producción, conviene usar Vite/webpack y compilar a JS sin Babel runtime.
- Migración sugerida: crear un proyecto Vite (React) y reubicar el widget en `/src`, empaquetando los estilos y el SPA existente progresivamente.
