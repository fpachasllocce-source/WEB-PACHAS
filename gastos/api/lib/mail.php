<?php
/* ==========================================================================
   Envío de correos: PHP mail() o SMTP (sin dependencias)
   ========================================================================== */
if (!defined('FS_APP')) { http_response_code(403); exit; }

function mail_from_address(): string {
    global $config;
    if ($config['mail_from'] !== '') return $config['mail_from'];
    $host = parse_url($config['app_url'], PHP_URL_HOST) ?: 'localhost';
    return 'no-responder@' . preg_replace('/^www\./', '', $host);
}

function encode_header(string $s): string {
    return preg_match('/[^\x20-\x7e]/', $s) ? '=?UTF-8?B?' . base64_encode($s) . '?=' : $s;
}

/** Builds headers + multipart body shared by both drivers. */
function build_message(string $to, string $subject, string $text, string $html): array {
    global $config;
    $from = mail_from_address();
    $boundary = 'b' . bin2hex(random_bytes(12));
    $domain = substr(strrchr($from, '@'), 1) ?: 'localhost';
    $headers = [
        'From' => encode_header($config['mail_from_name']) . " <$from>",
        'Reply-To' => $from,
        'Date' => date(DATE_RFC2822),
        'Message-ID' => '<' . bin2hex(random_bytes(16)) . "@$domain>",
        'MIME-Version' => '1.0',
        'Content-Type' => "multipart/alternative; boundary=\"$boundary\"",
    ];
    $body = "--$boundary\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"
          . chunk_split(base64_encode($text))
          . "--$boundary\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"
          . chunk_split(base64_encode($html))
          . "--$boundary--\r\n";
    return [$from, $headers, $body];
}

function send_mail(string $to, string $subject, string $text, string $html): bool {
    global $config;
    if (!filter_var($to, FILTER_VALIDATE_EMAIL)) return false;
    [$from, $headers, $body] = build_message($to, $subject, $text, $html);
    try {
        if ($config['mail_driver'] === 'smtp') return smtp_send($from, $to, $subject, $headers, $body);
        if ($config['mail_driver'] === 'log') {
            // For local testing: writes the email to api/data/mail.log instead of sending it
            file_put_contents(__DIR__ . '/../data/mail.log', "To: $to\nSubject: $subject\n\n$text\n-----\n", FILE_APPEND | LOCK_EX);
            return true;
        }
        $h = '';
        foreach ($headers as $k => $v) $h .= "$k: $v\r\n";
        return mail($to, encode_header($subject), $body, rtrim($h), '-f' . $from);
    } catch (Throwable $e) {
        error_log('[mis-finanzas] mail error: ' . $e->getMessage());
        return false;
    }
}

function smtp_send(string $from, string $to, string $subject, array $headers, string $body): bool {
    global $config;
    $secure = $config['smtp_secure'];
    $remote = ($secure === 'ssl' ? 'ssl://' : 'tcp://') . $config['smtp_host'] . ':' . (int)$config['smtp_port'];
    $sock = @stream_socket_client($remote, $errno, $errstr, 15);
    if (!$sock) throw new RuntimeException("SMTP connect: $errstr");
    stream_set_timeout($sock, 15);

    $read = function () use ($sock): array {
        $data = '';
        while (($line = fgets($sock, 1024)) !== false) {
            $data .= $line;
            if (strlen($line) < 4 || $line[3] === ' ') break;
        }
        return [(int)substr($data, 0, 3), $data];
    };
    $cmd = function (string $c, array $ok) use ($sock, $read): string {
        fwrite($sock, $c . "\r\n");
        [$code, $resp] = $read();
        if (!in_array($code, $ok, true)) throw new RuntimeException('SMTP ' . strtok($c, ' ') . ": $resp");
        return $resp;
    };

    [$code, $greet] = $read();
    if ($code !== 220) throw new RuntimeException("SMTP greeting: $greet");
    $ehloHost = parse_url($config['app_url'], PHP_URL_HOST) ?: 'localhost';
    $cmd("EHLO $ehloHost", [250]);
    if ($secure === 'tls') {
        $cmd('STARTTLS', [220]);
        if (!stream_socket_enable_crypto($sock, true, STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT)) {
            throw new RuntimeException('SMTP STARTTLS failed');
        }
        $cmd("EHLO $ehloHost", [250]);
    }
    if ($config['smtp_user'] !== '') {
        $cmd('AUTH LOGIN', [334]);
        $cmd(base64_encode($config['smtp_user']), [334]);
        $cmd(base64_encode($config['smtp_pass']), [235]);
    }
    $cmd("MAIL FROM:<$from>", [250]);
    $cmd("RCPT TO:<$to>", [250, 251]);
    $cmd('DATA', [354]);

    $msg = "To: <$to>\r\nSubject: " . encode_header($subject) . "\r\n";
    foreach ($headers as $k => $v) $msg .= "$k: $v\r\n";
    $msg .= "\r\n" . $body;
    $msg = preg_replace('/^\./m', '..', str_replace(["\r\n", "\n"], ["\n", "\r\n"], $msg)); // dot-stuffing
    $cmd($msg . "\r\n.", [250]);
    try { $cmd('QUIT', [221]); } catch (Throwable $e) {}
    fclose($sock);
    return true;
}

/** Simple branded email: a title, a paragraph, one button. */
function email_template(string $title, string $intro, string $button, string $url, string $outro): array {
    $e = fn($s) => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
    $html = '<!doctype html><html><body style="margin:0;background:#f4f4f1;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#0b0b0b">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">'
        . '<table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:18px;border:1px solid #e8e7e1" cellpadding="0" cellspacing="0">'
        . '<tr><td style="padding:28px 28px 8px"><div style="font-weight:800;font-size:15px">📈 Mis Finanzas</div></td></tr>'
        . '<tr><td style="padding:8px 28px 0"><h1 style="font-size:22px;margin:0 0 12px">' . $e($title) . '</h1>'
        . '<p style="font-size:15px;line-height:1.55;color:#52514e;margin:0 0 22px">' . $e($intro) . '</p>'
        . '<a href="' . $e($url) . '" style="display:inline-block;background:#111317;color:#ffffff;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:12px">' . $e($button) . '</a>'
        . '<p style="font-size:13px;line-height:1.5;color:#7a7873;margin:22px 0 0">' . $e($outro) . '</p>'
        . '<p style="font-size:12px;color:#7a7873;margin:18px 0 28px;word-break:break-all">Si el botón no funciona, copia este enlace en tu navegador:<br>' . $e($url) . '</p>'
        . '</td></tr></table></td></tr></table></body></html>';
    $text = "$title\n\n$intro\n\n$button: $url\n\n$outro\n";
    return [$text, $html];
}
