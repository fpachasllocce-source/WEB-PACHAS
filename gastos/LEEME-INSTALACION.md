# Mis Finanzas — instalación en Hostinger

1. Sube la carpeta `gastos/` completa (con `api/`) y el `.htaccess` de la raíz a `public_html/`.
2. Activa SSL (https) para tu dominio en Hostinger.
3. Crea en `gastos/api/` un archivo **`config.local.php`** (no se sube a GitHub) con tus datos:

```php
<?php return [
    'app_url'     => 'https://tudominio.com/gastos/',
    'mail_driver' => 'smtp',
    'mail_from'   => 'no-responder@tudominio.com',
    'smtp_user'   => 'no-responder@tudominio.com',
    'smtp_pass'   => 'LA-CONTRASEÑA-DE-ESE-CORREO',

    // Pago único de activación (Yape / Plin)
    'price'        => 10,
    'yape_number'  => '987 654 321',
    'yape_holder'  => 'Tu nombre como sale en Yape',
    'yape_qr'      => 'img/yape-qr.png',   // opcional: sube tu QR a gastos/img/
    'plin_number'  => '987 654 321',       // deja '' si no usas Plin
    'plin_holder'  => 'Tu nombre',

    // Tu correo de administrador (para aprobar pagos)
    'admin_emails' => ['tucorreo@gmail.com'],
];
```

   El correo `no-responder@tudominio.com` se crea en Hostinger → Correos.
   Sin `app_url` no se pueden enviar los enlaces de recuperar contraseña ni de confirmar correo.

4. Entra a `https://tudominio.com/gastos/`, crea tu cuenta con el correo de `admin_emails` y **confirma tu correo** con el enlace que te llega. Así entras sin pagar y ves el **Panel de administrador** en el menú ⋯.
5. Prueba "¿Olvidaste tu contraseña?" para confirmar que llegan los correos.

## Aprobar pagos

- Cuando alguien reporta su pago, te llega un correo "Pago por revisar".
- Abre tu app de Yape/Plin, busca el pago por **número de operación** y monto.
- En el menú ⋯ → **Panel de administrador**, pulsa **Aprobar** (la persona recibe un correo y entra) o **Rechazar** con el motivo.
- Si alguien te paga en efectivo, usa **Activar una cuenta a mano** con su correo.
- Para que la app sea gratis, pon `'payment_required' => false`.

## Copias de seguridad

- Se crean solas una vez al día en `gastos/api/data/backups/` (se guardan las últimas 14).
- Descárgalas de vez en cuando desde el Administrador de archivos de Hostinger y guárdalas fuera del servidor.
- **Restaurar:** descomprime el `.sqlite.gz` elegido, renómbralo a `finanzas.sqlite` y reemplaza `gastos/api/data/finanzas.sqlite` (borra también los archivos `finanzas.sqlite-wal` y `finanzas.sqlite-shm` si existen).
