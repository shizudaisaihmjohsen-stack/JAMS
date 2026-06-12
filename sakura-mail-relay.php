<?php
declare(strict_types=1);

// Upload this file to Sakura Rental Server and set these environment values
// outside the public document root when possible.
$relaySecret = getenv('SAKURA_MAIL_RELAY_SECRET') ?: 'CHANGE_ME';
$allowedDomains = array_filter(array_map('trim', explode(',', getenv('S_GATE_ALLOWED_EMAIL_DOMAINS') ?: 'shizuoka.ac.jp')));

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'method_not_allowed']);
    exit;
}

$authorization = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
if (!hash_equals('Bearer ' . $relaySecret, $authorization)) {
    http_response_code(401);
    echo json_encode(['error' => 'unauthorized']);
    exit;
}

$payload = json_decode(file_get_contents('php://input') ?: '', true);
if (!is_array($payload)) {
    http_response_code(400);
    echo json_encode(['error' => 'invalid_json']);
    exit;
}

$to = normalize_email($payload['to'] ?? '');
$subject = trim((string)($payload['subject'] ?? ''));
$text = (string)($payload['text'] ?? '');
$html = (string)($payload['html'] ?? '');
$from = normalize_from($payload['from'] ?? '');

if (!filter_var($to, FILTER_VALIDATE_EMAIL) || !is_allowed_domain($to, $allowedDomains)) {
    http_response_code(400);
    echo json_encode(['error' => 'invalid_recipient']);
    exit;
}

if ($subject === '' || ($text === '' && $html === '') || $from === '') {
    http_response_code(400);
    echo json_encode(['error' => 'missing_required_field']);
    exit;
}

$boundary = 's_gate_' . bin2hex(random_bytes(12));
$encodedSubject = mb_encode_mimeheader($subject, 'UTF-8');
$headers = [
    'From: ' . $from,
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="' . $boundary . '"',
];

$body = "--{$boundary}\r\n"
    . "Content-Type: text/plain; charset=UTF-8\r\n"
    . "Content-Transfer-Encoding: 8bit\r\n\r\n"
    . $text . "\r\n"
    . "--{$boundary}\r\n"
    . "Content-Type: text/html; charset=UTF-8\r\n"
    . "Content-Transfer-Encoding: 8bit\r\n\r\n"
    . ($html !== '' ? $html : nl2br(htmlspecialchars($text, ENT_QUOTES, 'UTF-8'))) . "\r\n"
    . "--{$boundary}--\r\n";

$sent = mb_send_mail($to, $encodedSubject, $body, implode("\r\n", $headers));
if (!$sent) {
    http_response_code(500);
    echo json_encode(['error' => 'mail_send_failed']);
    exit;
}

echo json_encode(['ok' => true]);

function normalize_email(mixed $value): string
{
    if (is_array($value) && isset($value['email'])) {
        return strtolower(trim((string)$value['email']));
    }
    return strtolower(trim((string)$value));
}

function normalize_from(mixed $value): string
{
    if (is_array($value) && isset($value['email'])) {
        $email = trim((string)$value['email']);
        $name = trim((string)($value['name'] ?? ''));
        if ($name !== '') {
            return mb_encode_mimeheader($name, 'UTF-8') . " <{$email}>";
        }
        return $email;
    }
    return trim((string)$value);
}

function is_allowed_domain(string $email, array $allowedDomains): bool
{
    $domain = substr(strrchr($email, '@') ?: '', 1);
    return in_array($domain, $allowedDomains, true);
}
