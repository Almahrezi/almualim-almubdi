// يعود العميل هنا من صفحة Paymob بعد الدفع. نتحقق من التوقيع ثم نحوّله لصفحة النتيجة في المتجر.
import { config as cfgFn, hmacForRedirect, sameHmac } from '../lib/paymob.mjs';

export default async (req) => {
  const url = new URL(req.url);
  const q = url.searchParams;
  const cfg = cfgFn();
  const ref = (q.get('merchant_order_id') || '').replace(/[^\w-]/g, '').slice(0, 40);

  let result = 'check';
  if (cfg.hmacSecret && sameHmac(hmacForRedirect(q, cfg.hmacSecret), q.get('hmac'))) {
    const ok = q.get('success') === 'true' && q.get('pending') !== 'true' &&
               q.get('is_voided') !== 'true' && q.get('is_refunded') !== 'true';
    result = ok ? 'ok' : (q.get('pending') === 'true' ? 'check' : 'fail');
  }

  return new Response(null, {
    status: 302,
    headers: { Location: url.origin + '/#/done/' + result + (ref ? '?ref=' + encodeURIComponent(ref) : ''), 'Cache-Control': 'no-store' },
  });
};

export const config = { path: '/api/payment-return' };
