const DEFAULT_ORIGIN = 'https://soloofertas.com';

function normalizeOrigin(value) {
  const candidate = String(value || DEFAULT_ORIGIN).trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Protocolo no permitido');
    return parsed.origin;
  } catch (err) {
    throw new Error(`PUBLIC_ORIGIN invalido: ${err.message}`);
  }
}

const PUBLIC_ORIGIN = normalizeOrigin(process.env.PUBLIC_ORIGIN);
const PUBLIC_HOST = new URL(PUBLIC_ORIGIN).host.toLowerCase();

module.exports = Object.freeze({
  name: 'Solo Ofertas',
  publicOrigin: PUBLIC_ORIGIN,
  publicHost: PUBLIC_HOST,
  whatsappHref: 'https://wa.me/523334477077',
  siblingOrigin: 'https://soloempleos.com.mx',
  features: Object.freeze({
    coupons: false,
    heroCarousel: false,
    backupRestore: true,
  }),
});
