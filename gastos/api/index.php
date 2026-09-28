<?php
/* ==========================================================================
   Mis Finanzas — API de cuentas y datos
   Acciones (?action=…): me, register, login, logout, data, save,
                         password, delete_account
   ========================================================================== */
declare(strict_types=1);
define('FS_APP', true);

$config = require __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const COOKIE_NAME = 'fs_session';
const MAX_DATA_BYTES = 2 * 1024 * 1024;

function respond(int $status, array $body = []): never {
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}
function fail(int $status, string $message): never {
    respond($status, ['error' => $message]);
}

/* ---------------- Database ---------------- */
function db(): PDO {
    static $pdo = null;
    global $config;
    if ($pdo) return $pdo;
    try {
        if ($config['driver'] === 'mysql') {
            $pdo = new PDO(
                'mysql:host=' . $config['mysql_host'] . ';dbname=' . $config['mysql_db'] . ';charset=utf8mb4',
                $config['mysql_user'], $config['mysql_pass']
            );
        } else {
            $dir = dirname($config['sqlite_path']);
            if (!is_dir($dir)) mkdir($dir, 0700, true);
            $pdo = new PDO('sqlite:' . $config['sqlite_path']);
            $pdo->exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
        }
    } catch (PDOException $e) {
        fail(500, 'No se pudo conectar con la base de datos.');
    }
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    migrate($pdo, $config['driver'] === 'mysql');
    return $pdo;
}

function migrate(PDO $pdo, bool $mysql): void {
    $id = $mysql ? 'INT AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    $text = $mysql ? 'MEDIUMTEXT' : 'TEXT';
    $engine = $mysql ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' : '';
    $pdo->exec("CREATE TABLE IF NOT EXISTS users (
        id $id,
        email VARCHAR(190) NOT NULL UNIQUE,
        name VARCHAR(80) NOT NULL DEFAULT '',
        password_hash VARCHAR(255) NOT NULL,
        created_at INTEGER NOT NULL
    )$engine");
    $pdo->exec("CREATE TABLE IF NOT EXISTS user_data (
        user_id INTEGER NOT NULL PRIMARY KEY,
        data $text NOT NULL,
        updated_at INTEGER NOT NULL
    )$engine");
    $pdo->exec("CREATE TABLE IF NOT EXISTS sessions (
        token_hash CHAR(64) NOT NULL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
    )$engine");
    $pdo->exec("CREATE TABLE IF NOT EXISTS attempts (
        id $id,
        bucket CHAR(64) NOT NULL,
        created_at INTEGER NOT NULL
    )$engine");
}

/* ---------------- Helpers ---------------- */
function client_ip(): string {
    return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
}
function is_https(): bool {
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}
function cookie_path(): string {
    // /ruta/gastos/api/index.php -> /ruta/gastos/
    $dir = rtrim(dirname(dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
    return $dir . '/';
}
function set_session_cookie(string $value, int $expires): void {
    setcookie(COOKIE_NAME, $value, [
        'expires'  => $expires,
        'path'     => cookie_path(),
        'secure'   => is_https(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}
function input(): array {
    $raw = file_get_contents('php://input', false, null, 0, MAX_DATA_BYTES + 1024);
    if ($raw === '' || $raw === false) return [];
    $data = json_decode($raw, true);
    if (!is_array($data)) fail(400, 'Solicitud no válida.');
    return $data;
}
function clean_email(string $email): string {
    return strtolower(trim($email));
}

/* Rate limiting (login and sign-up) */
function too_many(string $bucket, int $max, int $windowSec): bool {
    $st = db()->prepare('SELECT COUNT(*) FROM attempts WHERE bucket = ? AND created_at > ?');
    $st->execute([hash('sha256', $bucket), time() - $windowSec]);
    return (int)$st->fetchColumn() >= $max;
}
function record_attempt(string $bucket): void {
    db()->prepare('INSERT INTO attempts (bucket, created_at) VALUES (?, ?)')->execute([hash('sha256', $bucket), time()]);
}
function clear_attempts(string $bucket): void {
    db()->prepare('DELETE FROM attempts WHERE bucket = ?')->execute([hash('sha256', $bucket)]);
}

/* Sessions: random token in an HttpOnly cookie, only its hash is stored */
function start_session(int $userId): void {
    global $config;
    $token = bin2hex(random_bytes(32));
    $expires = time() + 86400 * (int)$config['session_days'];
    db()->prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
        ->execute([hash('sha256', $token), $userId, $expires]);
    set_session_cookie($token, $expires);
    // occasional cleanup of expired rows
    if (random_int(1, 20) === 1) {
        db()->prepare('DELETE FROM sessions WHERE expires_at < ?')->execute([time()]);
        db()->prepare('DELETE FROM attempts WHERE created_at < ?')->execute([time() - 86400]);
    }
}
function current_user(): ?array {
    $token = $_COOKIE[COOKIE_NAME] ?? '';
    if (!is_string($token) || !preg_match('/^[a-f0-9]{64}$/', $token)) return null;
    $st = db()->prepare('SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
                         WHERE s.token_hash = ? AND s.expires_at > ?');
    $st->execute([hash('sha256', $token), time()]);
    return $st->fetch() ?: null;
}
function require_user(): array {
    $u = current_user();
    if (!$u) fail(401, 'Tu sesión ha terminado. Vuelve a iniciar sesión.');
    return $u;
}
function public_user(array $u): array {
    return ['email' => $u['email'], 'name' => $u['name']];
}

/* ---------------- Request guard ---------------- */
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = $_GET['action'] ?? '';

if ($method === 'POST') {
    // Blocks cross-site form posts: browsers can't add this header to a plain
    // form, and a cross-origin fetch with it needs a CORS preflight we never allow.
    if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'fetch') fail(403, 'Solicitud no permitida.');
} elseif ($method !== 'GET') {
    fail(405, 'Método no permitido.');
}

/* ---------------- Actions ---------------- */
switch ("$method $action") {

case 'GET me':
    $u = current_user();
    if (!$u) respond(200, ['user' => null, 'inviteRequired' => $config['invite_code'] !== '']);
    respond(200, ['user' => public_user($u)]);

case 'POST register':
    $in = input();
    $name = trim((string)($in['name'] ?? ''));
    $email = clean_email((string)($in['email'] ?? ''));
    $pass = (string)($in['password'] ?? '');
    $ip = client_ip();

    if ($config['invite_code'] !== '' && !hash_equals($config['invite_code'], trim((string)($in['invite'] ?? '')))) {
        fail(403, 'El código de invitación no es correcto.');
    }
    if (mb_strlen($name) < 2 || mb_strlen($name) > 60) fail(422, 'Escribe tu nombre (2 a 60 caracteres).');
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 190) fail(422, 'Escribe un correo electrónico válido.');
    if (strlen($pass) < $config['min_password_length']) fail(422, 'La contraseña debe tener al menos ' . $config['min_password_length'] . ' caracteres.');
    if (strlen($pass) > 200) fail(422, 'La contraseña es demasiado larga.');
    if (too_many("reg|$ip", 10, 3600)) fail(429, 'Demasiados registros desde esta conexión. Inténtalo más tarde.');

    $st = db()->prepare('SELECT id FROM users WHERE email = ?');
    $st->execute([$email]);
    if ($st->fetch()) fail(409, 'Ya existe una cuenta con ese correo. Inicia sesión.');

    record_attempt("reg|$ip");
    db()->prepare('INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)')
        ->execute([$email, $name, password_hash($pass, PASSWORD_DEFAULT), time()]);
    $id = (int)db()->lastInsertId();
    start_session($id);
    respond(201, ['user' => ['email' => $email, 'name' => $name]]);

case 'POST login':
    $in = input();
    $email = clean_email((string)($in['email'] ?? ''));
    $pass = (string)($in['password'] ?? '');
    $bucket = 'login|' . client_ip() . '|' . $email;
    $window = 60 * (int)$config['lockout_minutes'];

    if (too_many($bucket, (int)$config['max_login_attempts'], $window)) {
        fail(429, 'Demasiados intentos fallidos. Espera ' . $config['lockout_minutes'] . ' minutos e inténtalo de nuevo.');
    }
    $st = db()->prepare('SELECT id, email, name, password_hash FROM users WHERE email = ?');
    $st->execute([$email]);
    $u = $st->fetch();
    // verify against a dummy hash when the user doesn't exist, so timing doesn't reveal accounts
    $hash = $u['password_hash'] ?? '$2y$12$yH8t3A2/NhhCLgXvRzDjTuo9S1ZBytYoXrplzguFzD/1D5Eh1tF5G';
    if (!password_verify($pass, $hash) || !$u) {
        record_attempt($bucket);
        fail(401, 'Correo o contraseña incorrectos.');
    }
    if (password_needs_rehash($u['password_hash'], PASSWORD_DEFAULT)) {
        db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([password_hash($pass, PASSWORD_DEFAULT), $u['id']]);
    }
    clear_attempts($bucket);
    start_session((int)$u['id']);
    respond(200, ['user' => public_user($u)]);

case 'POST logout':
    $token = $_COOKIE[COOKIE_NAME] ?? '';
    if (is_string($token) && $token !== '') {
        db()->prepare('DELETE FROM sessions WHERE token_hash = ?')->execute([hash('sha256', $token)]);
    }
    set_session_cookie('', time() - 3600);
    respond(200, ['ok' => true]);

case 'GET data':
    $u = require_user();
    $st = db()->prepare('SELECT data, updated_at FROM user_data WHERE user_id = ?');
    $st->execute([$u['id']]);
    $row = $st->fetch();
    respond(200, [
        'data' => $row ? json_decode($row['data'], true) : null,
        'updatedAt' => $row ? (int)$row['updated_at'] : null,
    ]);

case 'POST save':
    $u = require_user();
    $in = input();
    $data = $in['data'] ?? null;
    if (!is_array($data) || !isset($data['movements']) || !is_array($data['movements'])) fail(422, 'Datos no válidos.');
    $json = json_encode($data, JSON_UNESCAPED_UNICODE);
    if (strlen($json) > MAX_DATA_BYTES) fail(413, 'Has alcanzado el límite de datos de la cuenta.');
    $now = time();
    $pdo = db();
    $up = $pdo->prepare('UPDATE user_data SET data = ?, updated_at = ? WHERE user_id = ?');
    $up->execute([$json, $now, $u['id']]);
    if ($up->rowCount() === 0) {
        $pdo->prepare('INSERT INTO user_data (user_id, data, updated_at) VALUES (?, ?, ?)')->execute([$u['id'], $json, $now]);
    }
    respond(200, ['updatedAt' => $now]);

case 'POST password':
    $u = require_user();
    $in = input();
    $current = (string)($in['current'] ?? '');
    $new = (string)($in['new'] ?? '');
    $st = db()->prepare('SELECT password_hash FROM users WHERE id = ?');
    $st->execute([$u['id']]);
    if (!password_verify($current, (string)$st->fetchColumn())) fail(401, 'La contraseña actual no es correcta.');
    if (strlen($new) < $config['min_password_length'] || strlen($new) > 200) fail(422, 'La nueva contraseña debe tener al menos ' . $config['min_password_length'] . ' caracteres.');
    db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([password_hash($new, PASSWORD_DEFAULT), $u['id']]);
    // close every other session, keep this one
    db()->prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?')
        ->execute([$u['id'], hash('sha256', (string)$_COOKIE[COOKIE_NAME])]);
    respond(200, ['ok' => true]);

case 'POST delete_account':
    $u = require_user();
    $in = input();
    $st = db()->prepare('SELECT password_hash FROM users WHERE id = ?');
    $st->execute([$u['id']]);
    if (!password_verify((string)($in['password'] ?? ''), (string)$st->fetchColumn())) fail(401, 'La contraseña no es correcta.');
    $pdo = db();
    $pdo->beginTransaction();
    $pdo->prepare('DELETE FROM user_data WHERE user_id = ?')->execute([$u['id']]);
    $pdo->prepare('DELETE FROM sessions WHERE user_id = ?')->execute([$u['id']]);
    $pdo->prepare('DELETE FROM users WHERE id = ?')->execute([$u['id']]);
    $pdo->commit();
    set_session_cookie('', time() - 3600);
    respond(200, ['ok' => true]);

default:
    fail(404, 'Acción no encontrada.');
}
