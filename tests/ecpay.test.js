const { app, request, registerUser } = require('./setup');
const ecpay = require('../src/services/ecpayService');
const vectors = require('../.claude/skills/ecpay/test-vectors/checkmacvalue.json');

const HASH_KEY = process.env.ECPAY_HASH_KEY;
const HASH_IV = process.env.ECPAY_HASH_IV;

describe('ECPay CheckMacValue', () => {
  it('should match official SHA256 test vectors', () => {
    const sha = vectors.vectors.filter(v => v.method === 'SHA256' && v.params);
    expect(sha.length).toBeGreaterThan(0);
    for (const v of sha) {
      expect(ecpay.generateCheckMacValue(v.params, v.hashKey, v.hashIV)).toBe(v.expected);
    }
  });

  it('should reject a tampered CheckMacValue', () => {
    const params = { MerchantID: '3002607', TradeStatus: '1' };
    params.CheckMacValue = ecpay.generateCheckMacValue(params, HASH_KEY, HASH_IV);
    expect(ecpay.verifyCheckMacValue(params, HASH_KEY, HASH_IV)).toBe(true);
    expect(ecpay.verifyCheckMacValue({ ...params, TradeStatus: '0' }, HASH_KEY, HASH_IV)).toBe(false);
  });
});

describe('ECPay Order Payment API', () => {
  let token;
  let otherToken;
  let productId;
  let clock = Date.now();

  /** 每次呼叫前推進時間，避開查詢節流（5 秒） */
  function advanceClock() {
    clock += 10000;
    vi.spyOn(Date, 'now').mockReturnValue(clock);
  }

  /** 讓 fetch 回傳一份帶有效 CheckMacValue 的 QueryTradeInfo 回應 */
  function mockQuery(fields, { ok = true, status = 200, tamper = false } = {}) {
    const body = { MerchantID: process.env.ECPAY_MERCHANT_ID, TradeNo: '2610250000000001', ...fields };
    body.CheckMacValue = ecpay.generateCheckMacValue(body, HASH_KEY, HASH_IV);
    if (tamper) body.CheckMacValue = 'A'.repeat(64);
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok,
      status,
      text: async () => new URLSearchParams(body).toString(),
    });
  }

  async function createOrder(userToken = token) {
    await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId, quantity: 1 });
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ recipientName: '金流測試', recipientEmail: 'ecpay@example.com', recipientAddress: '台北市測試路 1 號' });
    return res.body.data;
  }

  async function checkout(orderId, userToken = token) {
    return request(app)
      .post(`/api/orders/${orderId}/ecpay/checkout`)
      .set('Authorization', `Bearer ${userToken}`);
  }

  function query(orderId, userToken = token) {
    advanceClock();
    return request(app)
      .post(`/api/orders/${orderId}/ecpay/query`)
      .set('Authorization', `Bearer ${userToken}`);
  }

  beforeAll(async () => {
    ({ token } = await registerUser());
    ({ token: otherToken } = await registerUser());
    const list = await request(app).get('/api/products?limit=100');
    const products = list.body.data.products;
    productId = products.reduce((a, b) => (b.stock > a.stock ? b : a)).id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return signed checkout params and expose payment_provider', async () => {
    const order = await createOrder();
    const res = await checkout(order.id);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('error', null);
    const { action, params } = res.body.data;
    expect(action).toContain('/Cashier/AioCheckOut/V5');
    expect(params.TotalAmount).toBe(String(order.total_amount));
    expect(params.ChoosePayment).toBe('Credit');
    expect(params.MerchantTradeNo).toMatch(/^[A-Za-z0-9]{1,20}$/);
    expect(params.ClientBackURL).toContain(`/orders/${order.id}?payment=return`);
    expect(ecpay.verifyCheckMacValue(params, HASH_KEY, HASH_IV)).toBe(true);

    const detail = await request(app)
      .get(`/api/orders/${order.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detail.body.data).toHaveProperty('payment_provider', 'ecpay');
  });

  it('should reject checkout for another user\'s order', async () => {
    const order = await createOrder();
    const res = await checkout(order.id, otherToken);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error', 'NOT_FOUND');
  });

  it('should reject query before checkout was started', async () => {
    const order = await createOrder();
    const res = await query(order.id);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('data', null);
  });

  it('should keep order pending when TradeStatus is 0, and throttle rapid queries', async () => {
    const order = await createOrder();
    await checkout(order.id);

    mockQuery({ TradeStatus: '0', TradeAmt: String(order.total_amount) });
    const res = await query(order.id);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('status', 'pending');

    // 不推進時間：第二次應被節流
    const again = await request(app)
      .post(`/api/orders/${order.id}/ecpay/query`)
      .set('Authorization', `Bearer ${token}`);
    expect(again.status).toBe(429);
  });

  it('should mark order paid when TradeStatus is 1, idempotently', async () => {
    const order = await createOrder();
    await checkout(order.id);

    mockQuery({
      TradeStatus: '1',
      TradeAmt: String(order.total_amount),
      PaymentType: 'Credit_CreditCard',
      PaymentDate: '2026/10/25 12:00:00',
    });
    const res = await query(order.id);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('status', 'paid');
    expect(res.body.data).toHaveProperty('payment_type', 'Credit_CreditCard');
    expect(res.body.data).toHaveProperty('ecpay_trade_no', '2610250000000001');

    // 已是終態：不再呼叫綠界
    global.fetch.mockClear();
    const again = await query(order.id);
    expect(again.status).toBe(200);
    expect(again.body.data).toHaveProperty('status', 'paid');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should mark order failed when TradeStatus is 10200095', async () => {
    const order = await createOrder();
    await checkout(order.id);

    mockQuery({ TradeStatus: '10200095', TradeAmt: String(order.total_amount) });
    const res = await query(order.id);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('status', 'failed');
  });

  it('should refuse to mark paid when amount mismatches', async () => {
    const order = await createOrder();
    await checkout(order.id);

    mockQuery({ TradeStatus: '1', TradeAmt: String(order.total_amount + 1) });
    const res = await query(order.id);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'PAYMENT_AMOUNT_MISMATCH');

    const detail = await request(app)
      .get(`/api/orders/${order.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detail.body.data).toHaveProperty('status', 'pending');
  });

  it('should return 502 when ECPay response has invalid CheckMacValue', async () => {
    const order = await createOrder();
    await checkout(order.id);

    mockQuery({ TradeStatus: '1', TradeAmt: String(order.total_amount) }, { tamper: true });
    const res = await query(order.id);
    expect(res.status).toBe(502);
    expect(res.body).toHaveProperty('error', 'PAYMENT_QUERY_FAILED');
  });

  it('should return 502 when ECPay responds with HTTP 403', async () => {
    const order = await createOrder();
    await checkout(order.id);

    mockQuery({}, { ok: false, status: 403 });
    const res = await query(order.id);
    expect(res.status).toBe(502);
    expect(res.body).toHaveProperty('error', 'PAYMENT_QUERY_FAILED');
  });

  it('should disable simulated pay while ECPay is enabled', async () => {
    const order = await createOrder();
    const res = await request(app)
      .patch(`/api/orders/${order.id}/pay`)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'success' });

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error', 'FORBIDDEN');
  });
});
