const express = require('express');
const nodemailer = require('nodemailer');
const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT, 10) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

router.post('/', async (req, res) => {
  const { nombre, email, asunto, mensaje } = req.body || {};

  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: 'Campos requeridos faltantes' });
  }
  if (!email || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ error: 'Correo electrónico inválido' });
  }
  if (!asunto || !asunto.trim()) {
    return res.status(400).json({ error: 'Campos requeridos faltantes' });
  }

  const mailOptions = {
    from: `"Solo Empleos" <${process.env.SMTP_USER}>`,
    to: process.env.EMAIL_DESTINO,
    subject: `[Solo Empleos] ${asunto.trim()}`,
    text: [
      `Nombre: ${nombre.trim()}`,
      `Email: ${email.trim()}`,
      `Asunto: ${asunto.trim()}`,
      `Mensaje: ${(mensaje || '').trim() || '(sin mensaje)'}`,
    ].join('\n'),
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
