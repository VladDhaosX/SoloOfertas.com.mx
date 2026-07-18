const express = require('express');
const nodemailer = require('nodemailer');
const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildHtml({ nombre, email, telefono, asunto, mensaje, fecha }) {
  const mensajeHtml = escapeHtml(mensaje).replace(/\r?\n/g, '<br>');
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nuevo mensaje — Solo Ofertas</title>
</head>
<body style="margin:0;padding:0;background:#f1f1f1;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f1f1;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:#1a1a1a;padding:24px 32px;border-bottom:3px solid #16a34a;">
              <h1 style="margin:0;font-size:20px;color:#ffffff;font-weight:600;letter-spacing:0.5px;">Solo Ofertas</h1>
              <p style="margin:4px 0 0;font-size:13px;color:#9ca3af;">Nuevo mensaje de contacto</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 20px;font-size:14px;color:#4b5563;">Recibiste un nuevo mensaje desde el formulario de contacto del sitio.</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;">
                <tr>
                  <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;width:110px;font-weight:600;">Nombre</td>
                  <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#1a1a1a;">${escapeHtml(nombre)}</td>
                </tr>
                <tr>
                  <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;font-weight:600;">Email</td>
                  <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#1a1a1a;"><a href="mailto:${escapeHtml(email)}" style="color:#16a34a;text-decoration:none;">${escapeHtml(email)}</a></td>
                </tr>
                <tr>
                  <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;font-weight:600;">Teléfono</td>
                  <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#1a1a1a;"><a href="tel:${escapeHtml(telefono)}" style="color:#16a34a;text-decoration:none;">${escapeHtml(telefono)}</a></td>
                </tr>
                <tr>
                  <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;font-weight:600;">Asunto</td>
                  <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#1a1a1a;">${escapeHtml(asunto)}</td>
                </tr>
                <tr>
                  <td style="padding:10px 0;color:#6b7280;font-weight:600;vertical-align:top;">Fecha</td>
                  <td style="padding:10px 0;color:#1a1a1a;">${escapeHtml(fecha)}</td>
                </tr>
              </table>
              <div style="margin-top:24px;padding:16px;background:#f9fafb;border-left:3px solid #16a34a;border-radius:4px;">
                <p style="margin:0 0 8px;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Mensaje</p>
                <p style="margin:0;font-size:14px;line-height:1.6;color:#1a1a1a;white-space:pre-wrap;">${mensajeHtml}</p>
              </div>
              <div style="margin-top:24px;text-align:center;">
                <a href="mailto:${escapeHtml(email)}?subject=Re:%20${encodeURIComponent(asunto)}" style="display:inline-block;padding:12px 28px;background:#16a34a;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">Responder</a>
              </div>
            </td>
          </tr>
          <tr>
            <td style="background:#f9fafb;padding:20px 32px;border-top:1px solid #e5e7eb;text-align:center;">
              <p style="margin:0;font-size:12px;color:#6b7280;">Este mensaje se generó automáticamente desde el formulario de contacto de <strong style="color:#1a1a1a;">Solo Ofertas</strong>.</p>
              <p style="margin:4px 0 0;font-size:11px;color:#9ca3af;">No respondas a este correo — usa el botón "Responder" para contactar al remitente.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

const SMTP_PORT = parseInt(process.env.SMTP_PORT, 10) || 587;
const SMTP_SECURE = process.env.SMTP_SECURE
  ? process.env.SMTP_SECURE === 'true'
  : SMTP_PORT === 465;

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_SECURE,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const REGION_LABEL = { gdl: 'Guadalajara', mty: 'Monterrey' };

router.post('/', async (req, res) => {
  const { nombre, email, telefono, asunto, mensaje, region } = req.body || {};

  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: 'Campos requeridos faltantes' });
  }
  if (!email || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ error: 'Correo electrónico inválido' });
  }
  if (!asunto || !asunto.trim()) {
    return res.status(400).json({ error: 'Campos requeridos faltantes' });
  }

  const regionKey = typeof region === 'string' ? region.toLowerCase() : '';
  const regionLabel = REGION_LABEL[regionKey] || 'General';

  const fecha = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
  const telefonoVal = (telefono || '').trim();

  const mailOptions = {
    from: `"Solo Ofertas ${regionLabel}" <${process.env.SMTP_USER}>`,
    replyTo: email.trim(),
    to: process.env.EMAIL_DESTINO,
    subject: `[Solo Ofertas ${regionLabel}] ${asunto.trim()}`,
    text: [
      `Región: ${regionLabel}`,
      `Nombre: ${nombre.trim()}`,
      `Email: ${email.trim()}`,
      `Teléfono: ${telefonoVal || '(no proporcionado)'}`,
      `Asunto: ${asunto.trim()}`,
      `Fecha: ${fecha}`,
      '',
      'Mensaje:',
      (mensaje || '').trim() || '(sin mensaje)',
    ].join('\n'),
    html: buildHtml({
      nombre: nombre.trim(),
      email: email.trim(),
      telefono: telefonoVal || '(no proporcionado)',
      asunto: asunto.trim(),
      mensaje: (mensaje || '').trim() || '(sin mensaje)',
      fecha,
    }),
  };

  try {
    await transporter.sendMail(mailOptions);
    res.json({ ok: true });
  } catch (err) {
    console.error('email send error:', err);
    res.status(500).json({ error: 'Error al enviar email' });
  }
});

module.exports = router;
