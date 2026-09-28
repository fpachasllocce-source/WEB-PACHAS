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
];
```

   El correo `no-responder@tudominio.com` se crea en Hostinger → Correos.
   Sin `app_url` no se pueden enviar los enlaces de recuperar contraseña ni de confirmar correo.

4. Entra a `https://tudominio.com/gastos/`, crea tu cuenta y prueba "¿Olvidaste tu contraseña?" para confirmar que llegan los correos.

## Copias de seguridad

- Se crean solas una vez al día en `gastos/api/data/backups/` (se guardan las últimas 14).
- Descárgalas de vez en cuando desde el Administrador de archivos de Hostinger y guárdalas fuera del servidor.
- **Restaurar:** descomprime el `.sqlite.gz` elegido, renómbralo a `finanzas.sqlite` y reemplaza `gastos/api/data/finanzas.sqlite` (borra también los archivos `finanzas.sqlite-wal` y `finanzas.sqlite-shm` si existen).
