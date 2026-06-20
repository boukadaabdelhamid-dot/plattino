interface SendResetEmailOptions {
  to: string;
  resetUrl: string;
}

function parseSender(raw: string | undefined): { name: string; email: string } {
  if (!raw) return { name: "Midanic", email: "no-reply@midanic.com" };
  const match = raw.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) return { name: match[1].replace(/^"|"$/g, "").trim() || "Midanic", email: match[2].trim() };
  return { name: "Midanic", email: raw.trim() };
}

function buildHtml(resetUrl: string): string {
  return `<!DOCTYPE html>
<html dir="ltr" lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#F5F5F0;font-family:sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;padding:40px;max-width:100%">
        <tr><td align="center" style="padding-bottom:24px">
          <span style="font-size:24px;font-weight:700;color:#1B3057">Midanic · ميدانيك</span>
        </td></tr>
        <tr><td style="color:#1B3057;font-size:18px;font-weight:600;padding-bottom:12px">
          Password Reset / إعادة تعيين كلمة المرور
        </td></tr>
        <tr><td style="color:#444;font-size:14px;line-height:1.6;padding-bottom:24px">
          <p>We received a request to reset your Midanic account password. Click the button below to set a new password. This link expires in <strong>1 hour</strong>.</p>
          <p dir="rtl">تلقينا طلبًا لإعادة تعيين كلمة مرور حسابك في ميدانيك. انقر على الزر أدناه لتعيين كلمة مرور جديدة. تنتهي صلاحية هذا الرابط خلال <strong>ساعة واحدة</strong>.</p>
        </td></tr>
        <tr><td align="center" style="padding-bottom:24px">
          <a href="${resetUrl}" style="display:inline-block;background:#1B3057;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600">
            Reset Password / إعادة تعيين كلمة المرور
          </a>
        </td></tr>
        <tr><td style="color:#888;font-size:12px;line-height:1.6;border-top:1px solid #eee;padding-top:16px">
          <p>If you did not request a password reset, you can safely ignore this email. / إذا لم تطلب إعادة تعيين كلمة المرور، يمكنك تجاهل هذا البريد الإلكتروني.</p>
          <p>This link will expire in 1 hour and can only be used once.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendViaBrevoApi(options: SendResetEmailOptions): Promise<void> {
  const { to, resetUrl } = options;
  const apiKey = process.env["BREVO_API_KEY"]!;
  const smtpUser = process.env["SMTP_USER"];
  const smtpFrom = process.env["SMTP_FROM"];
  const sender = parseSender(smtpFrom ?? smtpUser);

  console.log(`[email/brevo-api] BREVO_API_KEY prefix=${apiKey.substring(0, 12)}... sender=${JSON.stringify(sender)} to=${to}`);

  const body = JSON.stringify({
    sender,
    to: [{ email: to }],
    subject: "Reset your Midanic password / إعادة تعيين كلمة مرور ميدانيك",
    htmlContent: buildHtml(resetUrl),
    textContent: `Reset your password: ${resetUrl}\n\nExpires in 1 hour, single-use only.`,
  });

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body,
  });

  const payload = await res.json().catch(() => ({}));

  if (!res.ok) {
    console.error(`[email/brevo-api] failed status=${res.status} body=${JSON.stringify(payload)}`);
    throw new Error(`Brevo API error ${res.status}: ${(payload as { message?: string }).message ?? res.statusText}`);
  }

  console.log(`[email/brevo-api] delivered messageId=${(payload as { messageId?: string }).messageId}`);
}

async function sendViaSmtp(options: SendResetEmailOptions): Promise<void> {
  const { to, resetUrl } = options;
  const { default: nodemailer } = await import("nodemailer");

  const port = parseInt(process.env["SMTP_PORT"] ?? "587", 10);
  const secure = process.env["SMTP_SECURE"] !== undefined && process.env["SMTP_SECURE"] !== ""
    ? process.env["SMTP_SECURE"] === "true" || process.env["SMTP_SECURE"] === "1"
    : port === 465;

  const host = process.env["SMTP_HOST"]!;
  const user = process.env["SMTP_USER"]!;

  console.log(`[email/smtp] host=${host} port=${port} secure=${secure} user=${user}`);

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure && port === 587,
    auth: { user, pass: process.env["SMTP_PASS"] },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  const raw = process.env["SMTP_FROM"] ?? user;
  const from = raw.includes("<") ? raw : `"Midanic · ميدانيك" <${raw}>`;

  console.log(`[email/smtp] attempting to=${to} from=${from}`);

  try {
    const info = await transporter.sendMail({
      from,
      to,
      subject: "Reset your Midanic password / إعادة تعيين كلمة مرور ميدانيك",
      html: buildHtml(resetUrl),
      text: `Reset your password: ${resetUrl}\n\nExpires in 1 hour, single-use only.`,
    });
    console.log(`[email/smtp] delivered messageId=${info.messageId} response=${info.response}`);
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException & { command?: string; responseCode?: number; response?: string };
    console.error(
      `[email/smtp] error code=${e.code} command=${e.command} responseCode=${e.responseCode} response=${e.response} message=${e.message}`
    );
    throw err;
  }
}

export async function sendPasswordResetEmail(options: SendResetEmailOptions): Promise<void> {
  const hasBrevoApi = !!process.env["BREVO_API_KEY"];
  const hasSmtp = !!(process.env["SMTP_HOST"] && process.env["SMTP_USER"] && process.env["SMTP_PASS"]);

  if (!hasBrevoApi && !hasSmtp) {
    throw new Error(
      "Email delivery is not configured. Set BREVO_API_KEY (preferred) or SMTP_HOST/SMTP_USER/SMTP_PASS."
    );
  }

  if (hasBrevoApi) {
    console.log("[email] using Brevo API transport");
    return sendViaBrevoApi(options);
  }

  console.log("[email] using SMTP transport (BREVO_API_KEY not set)");
  return sendViaSmtp(options);
}
