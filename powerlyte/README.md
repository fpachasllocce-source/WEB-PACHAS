# Powerlyte — web de marca

Sitio estático (HTML + CSS + JS vanilla, sin build). Abrir `index.html` o subir la carpeta tal cual al hosting.

## Qué editar antes de publicar
- **Tabla nutricional, sabores y tamaños** → `main.js`, bloque `FLAVORS`, `SIZES`, `NUTRITION_100` (valores por 100 ml; hoy son REFERENCIALES). `FLAVOR_OVERRIDES` para diferencias por sabor.
- **Imágenes** → todos los placeholders llevan la etiqueta `IMG · … · medidas`. Guardar en `assets/img/`.
  - Botellas: PNG transparente 800×1800 por sabor y tamaño (reemplazan al SVG de la botella).
- **Especialista** → sección Ciencia, bloque `.expert` (cita, nombre, colegiatura CNP/CMP).
- **Atletas, eventos, redes** → sección Comunidad (`href="#"` pendientes).
- **Retailers / e-commerce, registro sanitario, logo oficial** → sección Comprar y footer.
