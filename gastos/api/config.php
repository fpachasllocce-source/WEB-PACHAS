<?php
/* ==========================================================================
   Configuración del servidor de Mis Finanzas
   ========================================================================== */
if (!defined('FS_APP')) { http_response_code(403); exit; }

return [
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

    // Seguridad
    'min_password_length' => 8,
    'max_login_attempts'  => 5,    // intentos fallidos permitidos…
    'lockout_minutes'     => 15,   // …en esta ventana de tiempo
    'session_days'        => 30,   // cuánto tiempo sigue iniciada la sesión
];
