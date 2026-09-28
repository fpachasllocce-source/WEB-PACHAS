# Powerlyte — web de marca

Sitio estático (HTML + CSS + JS vanilla, sin build). Abrir `index.html` o subir la carpeta tal cual al hosting.

## Qué editar antes de publicar
- **Tabla nutricional, sabores y tamaños** → `main.js`, bloques `FLAVORS`, `SIZES` y `NUTRITION` (valores del rotulado oficial por porción de 250 ml, sabor Tropical). `FLAVOR_OVERRIDES` si algún sabor difiere.
- **Imágenes reales** en `assets/img/` (hero, línea de sabores, momentos Antes/Durante/Después/Calor, Comunidad, eventos, UGC). Faltan fotos de Frambuesa azul y Uva y un PNG transparente por sabor.
- **Imágenes pendientes** → todos los placeholders llevan la etiqueta `IMG · … · medidas`. Guardar en `assets/img/`.
  - Botellas: PNG transparente 800×1800 por sabor y tamaño (reemplazan al SVG de la botella).
- **Especialista** → sección Ciencia, bloque `.expert` (cita, nombre, colegiatura CNP/CMP).
- **Atletas, eventos, redes** → sección Comunidad (`href="#"` pendientes).
- **Retailers / e-commerce, registro sanitario, logo oficial** → sección Comprar y footer.
