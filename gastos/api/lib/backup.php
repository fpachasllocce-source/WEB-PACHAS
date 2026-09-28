<?php
/* ==========================================================================
   Copias de seguridad automáticas de la base de datos
   Se ejecutan solas, como mucho una vez cada 'backup_every_hours', cuando
   alguien usa la app. Se guardan comprimidas en api/data/backups/.
   ========================================================================== */
if (!defined('FS_APP')) { http_response_code(403); exit; }

function backup_dir(): string {
    return __DIR__ . '/../data/backups';
}

function maybe_backup(): void {
    global $config;
    $dir = backup_dir();
    $stamp = $dir . '/.last';
    $every = 3600 * max(1, (int)$config['backup_every_hours']);
    if (is_file($stamp) && time() - (int)@filemtime($stamp) < $every) return;

    if (!is_dir($dir) && !@mkdir($dir, 0700, true)) return;
    // lock so two simultaneous requests don't both run the backup
    $lock = @fopen($dir . '/.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) return;
    try {
        touch($stamp);
        run_backup($dir);
        prune_backups($dir, max(1, (int)$config['backup_keep']));
    } catch (Throwable $e) {
        error_log('[mis-finanzas] backup error: ' . $e->getMessage());
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

function run_backup(string $dir): string {
    global $config;
    $name = 'finanzas-' . date('Y-m-d_His');
    if ($config['driver'] === 'sqlite') {
        // VACUUM INTO writes a consistent snapshot, even while others are writing
        $tmp = "$dir/$name.sqlite";
        try {
            db()->exec('VACUUM INTO ' . db()->quote($tmp));
        } catch (PDOException $e) {
            // SQLite older than 3.27: flush the journal and copy the file
            db()->exec('PRAGMA wal_checkpoint(FULL)');
            copy($config['sqlite_path'], $tmp);
        }
        $out = "$tmp.gz";
        gz_file($tmp, $out);
        unlink($tmp);
        return $out;
    }
    // MySQL: export the tables that matter as JSON
    $dump = ['created_at' => date(DATE_ATOM), 'tables' => []];
    foreach (['users', 'user_data'] as $t) {
        $dump['tables'][$t] = db()->query("SELECT * FROM $t")->fetchAll();
    }
    $out = "$dir/$name.json.gz";
    file_put_contents($out, gzencode(json_encode($dump, JSON_UNESCAPED_UNICODE), 9), LOCK_EX);
    return $out;
}

function gz_file(string $src, string $dst): void {
    $in = fopen($src, 'rb');
    $out = gzopen($dst, 'wb9');
    while (!feof($in)) gzwrite($out, fread($in, 1 << 20));
    fclose($in);
    gzclose($out);
}

function prune_backups(string $dir, int $keep): void {
    $files = array_merge(glob("$dir/finanzas-*.sqlite.gz") ?: [], glob("$dir/finanzas-*.json.gz") ?: []);
    rsort($files); // names carry the date, newest first
    foreach (array_slice($files, $keep) as $old) @unlink($old);
}
