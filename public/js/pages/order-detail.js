const { createApp, ref, onMounted } = Vue;

createApp({
  setup() {
    if (!Auth.requireAuth()) return {};

    const el = document.getElementById('app');
    const orderId = el.dataset.orderId;
    const paymentResult = ref(el.dataset.paymentResult || null);

    const order = ref(null);
    const loading = ref(true);
    const paying = ref(false);
    const querying = ref(false);
    const queryHint = ref('');

    const statusMap = {
      pending: { label: '待付款', cls: 'bg-apricot/20 text-apricot' },
      paid: { label: '已付款', cls: 'bg-sage/20 text-sage' },
      failed: { label: '付款失敗', cls: 'bg-red-100 text-red-600' },
    };

    const paymentMessages = {
      success: { text: '付款成功！感謝您的購買。', cls: 'bg-sage/10 text-sage border border-sage/20' },
      failed: { text: '付款失敗，請重試。', cls: 'bg-red-50 text-red-600 border border-red-100' },
      cancel: { text: '付款已取消。', cls: 'bg-apricot/10 text-apricot border border-apricot/20' },
    };

    async function simulatePay(action) {
      if (!order.value || paying.value) return;
      paying.value = true;
      try {
        const res = await apiFetch('/api/orders/' + order.value.id + '/pay', {
          method: 'PATCH',
          body: JSON.stringify({ action })
        });
        order.value = res.data;
        paymentResult.value = action === 'success' ? 'success' : 'failed';
      } catch (e) {
        Notification.show('付款處理失敗', 'error');
      } finally {
        paying.value = false;
      }
    }

    // 導向綠界付款頁：以動態表單 POST（不可 iframe）
    async function goEcpay() {
      if (!order.value || paying.value) return;
      paying.value = true;
      try {
        const res = await apiFetch('/api/orders/' + order.value.id + '/ecpay/checkout', { method: 'POST' });
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = res.data.action;
        Object.entries(res.data.params).forEach(function ([name, value]) {
          const input = document.createElement('input');
          input.type = 'hidden';
          input.name = name;
          input.value = value;
          form.appendChild(input);
        });
        document.body.appendChild(form);
        form.submit();
      } catch (e) {
        Notification.show((e.data && e.data.message) || '無法前往綠界付款', 'error');
        paying.value = false;
      }
    }

    // 主動向綠界查詢付款結果（本機收不到 Server Notify）
    async function queryEcpay() {
      if (!order.value || querying.value) return;
      querying.value = true;
      queryHint.value = '';
      try {
        const res = await apiFetch('/api/orders/' + order.value.id + '/ecpay/query', { method: 'POST' });
        order.value = res.data;
        if (res.data.status === 'paid') paymentResult.value = 'success';
        else if (res.data.status === 'failed') paymentResult.value = 'failed';
        else queryHint.value = res.message;
      } catch (e) {
        Notification.show((e.data && e.data.message) || '查詢付款結果失敗', 'error');
      } finally {
        querying.value = false;
      }
    }

    function handlePaySuccess() { simulatePay('success'); }
    function handlePayFail() { simulatePay('fail'); }

    onMounted(async function () {
      try {
        const res = await apiFetch('/api/orders/' + orderId);
        order.value = res.data;
      } catch (e) {
        Notification.show('載入訂單失敗', 'error');
      } finally {
        loading.value = false;
      }
      // 從綠界返回商店：自動查詢付款結果
      if (paymentResult.value === 'return') {
        paymentResult.value = null;
        if (order.value && order.value.status === 'pending' && order.value.payment_provider === 'ecpay') {
          queryEcpay();
        }
      }
    });

    return { order, loading, paying, querying, queryHint, goEcpay, queryEcpay, paymentResult, statusMap, paymentMessages, handlePaySuccess, handlePayFail };
  }
}).mount('#app');
