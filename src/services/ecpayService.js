const crypto = require('crypto');

// Source: guides/13-checkmacvalue.md (Node.js), 官方規格 2858.md (AIO)、2890.md (QueryTradeInfo)
const ENDPOINTS = {
  staging: 'https://payment-stage.ecpay.com.tw',
  production: 'https://payment.ecpay.com.tw'
};

function isEnabled() {
  return Boolean(process.env.ECPAY_MERCHANT_ID && process.env.ECPAY_HASH_KEY && process.env.ECPAY_HASH_IV);
}

function getConfig() {
  const env = process.env.ECPAY_ENV === 'production' ? 'production' : 'staging';
  return {
    merchantId: process.env.ECPAY_MERCHANT_ID,
    hashKey: process.env.ECPAY_HASH_KEY,
    hashIv: process.env.ECPAY_HASH_IV,
    baseUrl: ENDPOINTS[env],
    appUrl: (process.env.BASE_URL || 'http://localhost:3001').replace(/\/$/, '')
  };
}

function ecpayUrlEncode(source) {
  let encoded = encodeURIComponent(source).replace(/%20/g, '+').replace(/~/g, '%7e').replace(/'/g, '%27');
  encoded = encoded.toLowerCase();
  const replacements = {
    '%2d': '-', '%5f': '_', '%2e': '.', '%21': '!',
    '%2a': '*', '%28': '(', '%29': ')'
  };
  for (const [old, char] of Object.entries(replacements)) {
    encoded = encoded.split(old).join(char);
  }
  return encoded;
}

function generateCheckMacValue(params, hashKey, hashIv, method = 'sha256') {
  const sorted = Object.keys(params)
    .filter(k => k !== 'CheckMacValue')
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const paramStr = sorted.map(k => `${k}=${params[k]}`).join('&');
  const raw = `HashKey=${hashKey}&${paramStr}&HashIV=${hashIv}`;
  return crypto.createHash(method).update(ecpayUrlEncode(raw), 'utf8').digest('hex').toUpperCase();
}

function verifyCheckMacValue(params, hashKey, hashIv, method = 'sha256') {
  const a = Buffer.from(String(params.CheckMacValue || ''));
  const b = Buffer.from(generateCheckMacValue(params, hashKey, hashIv, method));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** MerchantTradeNo：僅英數、最長 20 字元、不可重複；每次發起付款重新產生 */
function generateMerchantTradeNo() {
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `FL${Date.now().toString(36).toUpperCase()}${rand}`.slice(0, 20);
}

/** MerchantTradeDate 須為 UTC+8，格式 yyyy/MM/dd HH:mm:ss */
function formatTradeDate(date = new Date()) {
  const t = new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString();
  return `${t.slice(0, 10).replace(/-/g, '/')} ${t.slice(11, 19)}`;
}

function sanitizeItemName(items) {
  const name = items.map(i => `${i.product_name} x${i.quantity}`).join('#');
  // 移除控制字元與 HTML 符號；官方建議 200 字元內，避免截斷造成 CheckMacValue 不一致
  return name.replace(/[\x00-\x1F<>&"]/g, '').slice(0, 200);
}

/** 產生送往 AioCheckOut/V5 的表單欄位（含 CheckMacValue） */
function buildCheckoutParams(order, items, merchantTradeNo) {
  const cfg = getConfig();
  const params = {
    MerchantID: cfg.merchantId,
    MerchantTradeNo: merchantTradeNo,
    MerchantTradeDate: formatTradeDate(),
    PaymentType: 'aio',
    TotalAmount: String(order.total_amount),
    TradeDesc: 'Flower Life Order',
    ItemName: sanitizeItemName(items),
    // 本機無法接收 Server Notify；AIO 要求必填，僅為佔位，付款結果改由 QueryTradeInfo 驗證
    ReturnURL: `${cfg.appUrl}/api/payments/ecpay/notify`,
    ClientBackURL: `${cfg.appUrl}/orders/${order.id}?payment=return`,
    ChoosePayment: 'Credit',
    EncryptType: '1'
  };
  params.CheckMacValue = generateCheckMacValue(params, cfg.hashKey, cfg.hashIv);
  return { action: `${cfg.baseUrl}/Cashier/AioCheckOut/V5`, params };
}

/**
 * 主動查詢綠界交易（QueryTradeInfo/V5），回傳已驗證 CheckMacValue 的欄位物件。
 * 失敗一律丟出 Error（呼叫端轉為 502 PAYMENT_QUERY_FAILED）。
 */
async function queryTradeInfo(merchantTradeNo) {
  const cfg = getConfig();
  const params = {
    MerchantID: cfg.merchantId,
    MerchantTradeNo: merchantTradeNo,
    TimeStamp: String(Math.floor(Date.now() / 1000)) // Unix 秒，3 分鐘內有效
  };
  params.CheckMacValue = generateCheckMacValue(params, cfg.hashKey, cfg.hashIv);

  const res = await fetch(`${cfg.baseUrl}/Cashier/QueryTradeInfo/V5`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) {
    throw new Error(`ECPay QueryTradeInfo HTTP ${res.status}`);
  }

  const result = Object.fromEntries(new URLSearchParams(await res.text()));
  if (!verifyCheckMacValue(result, cfg.hashKey, cfg.hashIv)) {
    throw new Error('ECPay QueryTradeInfo CheckMacValue 驗證失敗');
  }
  return result;
}

module.exports = {
  isEnabled,
  getConfig,
  ecpayUrlEncode,
  generateCheckMacValue,
  verifyCheckMacValue,
  generateMerchantTradeNo,
  buildCheckoutParams,
  queryTradeInfo
};
