<?php
/* ==========================================================================
   Configuración del servidor de Mis Finanzas
   ========================================================================== */
if (!defined('FS_APP')) { http_response_code(403); exit; }

// Consejo: no escribas contraseñas (SMTP, MySQL) en este archivo si lo subes a
// GitHub. Crea en esta misma carpeta un archivo config.local.php (no se sube a
// git) con solo lo que quieras cambiar, por ejemplo:
//   <?php return ['smtp_pass' => 'tu-clave', 'app_url' => 'https://tudominio.com/gastos/'];

$config = [
    // Base de datos. Por defecto SQLite: un archivo, sin configurar nada.
    // Si prefieres MySQL (Hostinger → Bases de datos), cambia 'driver' a 'mysql'
    // y rellena los datos de conexión.
    'driver'      => 'sqlite',
    'sqlite_path' => __DIR__ . '/data/finanzas.sqlite',

    'mysql_host'  => 'localhost',
    'mysql_db'    => '',
    'mysql_user'  => '',
    'mysql_pass'  => '',

    // Código de invitación. Déjalo vacío ('') para que cualquiera con el enlace
    // pueda registrarse. Si pones un código (ej. 'PACHAS2026'), solo podrán
    // crear cuenta las personas a las que se lo des.
    'invite_code' => '',

    // Dirección pública de la app, con https y la barra final.
    // Se usa en los enlaces de los correos (recuperar contraseña, confirmar correo).
    // Ejemplo: 'https://tudominio.com/gastos/'
    'app_url'     => '',

    // Envío de correos
    //  'mail' → función mail() de PHP (funciona en Hostinger sin configurar nada,
    //           aunque a veces los correos llegan a spam).
    //  'smtp' → recomendado: usa una cuenta de correo de tu dominio
    //           (Hostinger → Correos → crea p. ej. no-responder@tudominio.com).
    'mail_driver' => 'mail',
    'mail_from'      => '',               // ej. 'no-responder@tudominio.com' (vacío = no-responder@tu dominio)
    'mail_from_name' => 'Mis Finanzas',
    'smtp_host'   => 'smtp.hostinger.com',
    'smtp_port'   => 465,
    'smtp_secure' => 'ssl',               // 'ssl' (puerto 465), 'tls' (puerto 587) o '' (sin cifrar)
    'smtp_user'   => '',                  // normalmente el mismo correo de mail_from
    'smtp_pass'   => '',

    // Copias de seguridad automáticas de la base de datos (en api/data/backups/)
    'backup_every_hours' => 24,
    'backup_keep'        => 14,           // cuántas copias guardar (las más antiguas se borran)

    // Seguridad
    'min_password_length' => 8,
    'max_login_attempts'  => 5,    // intentos fallidos permitidos…
    'lockout_minutes'     => 15,   // …en esta ventana de tiempo
    'session_days'        => 30,   // cuánto tiempo sigue iniciada la sesión
];

$local = __DIR__ . '/config.local.php';
return is_file($local) ? array_merge($config, (array)require $local) : $config;
