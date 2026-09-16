(function () {
  "use strict";
  window.__BRAND__ = {
    name: "QR3D",
    tagline: "Generador de códigos QR listos para imprimir en 3D",
    lang: "es",
    contact: { email: "" },

    styles: [
      { id: "clasico",    label: "Clásico" },
      { id: "redondeado", label: "Redondeado" },
      { id: "puntos",     label: "Puntos" },
      { id: "elegante",   label: "Elegante" }
    ],

    formats3d: [
      { id: "soporte", label: "Soporte de mesa", desc: "Cuña inclinada, se imprime sin soportes. Ideal para mostrador, carta de restaurante o \"déjanos una reseña\"." },
      { id: "llavero",  label: "Llavero", desc: "Placa plana de 3 mm con anilla para el llavero." },
      { id: "placa",    label: "Placa para colgar", desc: "Placa plana de 3,2 mm con dos agujeros para colgar." }
    ],

    faqs: [
      {
        q: "¿El QR que descargo funciona de verdad?",
        a: "Sí. Se genera con el estándar QR completo (con corrección de errores) y puedes escanearlo con la cámara del móvil antes de descargarlo o imprimirlo."
      },
      {
        q: "¿Qué es el archivo 3MF y por qué no descargo directamente un STL?",
        a: "El 3MF guarda el color de cada pieza dentro del propio archivo. Al abrirlo en tu laminadora (Bambu Studio, PrusaSlicer, OrcaSlicer, Cura) verás automáticamente dos piezas: la base y el código en relieve, cada una con su color asignado. El STL no guarda color — por eso lo dejamos como descarga secundaria para impresoras o flujos más antiguos."
      },
      {
        q: "¿Necesito una impresora multicolor o multimaterial?",
        a: "Es lo ideal (AMS, cambiador de filamento o impresión con pausa manual para cambiar de color a media altura), porque el contraste de color es lo que hace que el QR se pueda escanear. Si tu impresora es de un solo color, imprime la base y el relieve por separado en dos colores y luego pégalos."
      },
      {
        q: "¿Por qué el código no escanea bien al imprimirlo?",
        a: "Las causas más comunes: poco contraste entre los dos colores elegidos, módulos demasiado pequeños (menos de 1,5 mm) o un logo central demasiado grande. La herramienta te avisa en rojo cuando detecta cualquiera de estos problemas antes de que descargues el archivo."
      },
      {
        q: "¿Puedo poner el logo de mi negocio en el centro?",
        a: "Sí. Puedes subir una imagen o elegir un emoji. En el diseño 2D se ve a todo color; en la pieza 3D se convierte automáticamente en una silueta de un solo color para que quede en relieve, en el mismo sitio donde lo ves en pantalla."
      },
      {
        q: "¿Cuánto tarda en imprimirse?",
        a: "Depende del tamaño y la impresora, pero una placa u llavero de QR con relieve de 1,2 mm suele imprimirse en 30-90 minutos con ajustes estándar (capa de 0,2 mm)."
      },
      {
        q: "¿Mis datos (enlace, wifi, texto) se suben a algún servidor?",
        a: "No. Todo el diseño, el cálculo del QR y la generación del archivo 3D ocurren en tu propio navegador. Nada se envía a ningún servidor."
      },
      {
        q: "¿Puedo usar el código para compartir el wifi de mi negocio?",
        a: "Sí, elige el modo \"Wifi\" e introduce el nombre de la red y la contraseña — el QR generado conecta el móvil automáticamente al escanearlo, sin necesidad de escribir nada."
      }
    ]
  };
})();
