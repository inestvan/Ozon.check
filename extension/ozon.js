// «Мои заказы» на Ozon → склад. Данные берём так же, как их берёт сама страница Ozon (её JSON),
// с вашим входом в этой вкладке. Пароль и платёжные данные не читаются и никуда не уходят.
(() => {
  if (document.getElementById('sprut-send')) return;

  const MONTHS = { январ: 1, феврал: 2, март: 3, апрел: 4, ма: 5, июн: 6, июл: 7, август: 8, сентябр: 9, октябр: 10, ноябр: 11, декабр: 12 };

  async function page(url) {
    const r = await fetch('/api/entrypoint-api.bx/page/json/v2?url=' + encodeURIComponent(url), { credentials: 'include' });
    if (!r.ok) throw new Error(`Ozon ответил ${r.status}`);
    const j = await r.json();
    const states = {};
    for (const [k, v] of Object.entries(j.widgetStates || {})) {
      try { states[k] = JSON.parse(v); } catch (_) {}
    }
    return states;
  }

  const widgets = (states, name) => Object.entries(states).filter(([k]) => k.startsWith(name + '-')).map(([, v]) => v);
  const money = (text) => {
    const m = String(text || '').replace(/[\s  ]/g, '').match(/(\d+(?:[.,]\d+)?)₽/);
    return m ? Number(m[1].replace(',', '.')) : null;
  };

  // «Заказ от 17 октября» (год Ozon пишет только у прошлых лет)
  function parseDate(text) {
    const m = String(text || '').toLowerCase().match(/(\d{1,2})\s+([а-я]+)(?:\s+(\d{4}))?/);
    if (!m) return null;
    const key = Object.keys(MONTHS).sort((a, b) => b.length - a.length).find((k) => m[2].startsWith(k));
    if (!key) return null;
    const now = new Date();
    const month = MONTHS[key];
    let year = m[3] ? Number(m[3]) : now.getFullYear();
    if (!m[3] && month > now.getMonth() + 1) year -= 1;
    return `${year}-${String(month).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  }

  async function orderNumbers() {
    const nums = [];
    for (const tab of ['active', 'archive']) {
      const states = await page('/my/orderlist?selectedTab=' + tab);
      for (const n of JSON.stringify(states).match(/order=\d+-\d+/g) || []) nums.push(n.slice(6));
    }
    return [...new Set(nums)];
  }

  async function order(number) {
    const states = await page('/my/orderdetails/?order=' + number);
    const title = widgets(states, 'titleWithTimer')[0]?.title?.text || '';
    const total = widgets(states, 'orderDoneTotal')[0]?.total?.right?.price?.text;
    const items = [];
    const status = [];
    for (const s of widgets(states, 'shipmentWidget')) {
      const head = (s.header || []).find((h) => h.type === 'textIcon')?.textIcon?.text?.text;
      if (head) status.push(head);
      if (/отмен/i.test(head || '')) continue;   // отменённая часть заказа — не приедет
      for (const it of s.items || []) for (const seller of it.sellers || []) for (const p of seller.products || []) {
        const link = p.title?.common?.action?.link || '';
        const extra = JSON.stringify({ a: p.attributes, pr: p.price, q: p.quantity });
        const qty = Number((extra.match(/(\d+)\s*шт/) || extra.match(/[×x]\s*(\d+)/) || [])[1]) || 1;
        items.push({
          sku: String(p.title?.common?.action?.id || (link.match(/-(\d+)\/?(?:\?|$)/) || [])[1] || ''),
          name: p.title?.name?.text || '',
          variant: (p.attributes || []).map((a) => a.text).filter(Boolean).join(', '),
          url: link ? 'https://www.ozon.ru' + link.split('?')[0] : '',
          price: money((p.price?.price || []).map((x) => x.text).join(' ')),
          qty,
        });
      }
    }
    return {
      number, date: parseDate(title), status: [...new Set(status)].join(' · '), amount: money(total),
      url: 'https://www.ozon.ru/my/orderdetails/?order=' + number, items,
    };
  }

  const btn = document.createElement('button');
  btn.id = 'sprut-send';
  btn.textContent = '📦 В склад СПРУТ';
  btn.title = 'Отправить последние заказы во «Входящие заказы» склада';
  btn.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483647;padding:12px 18px;border:0;border-radius:12px;'
    + 'background:#4E6526;color:#fff;font:600 15px system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.25);cursor:pointer';
  const note = document.createElement('div');
  note.style.cssText = 'position:fixed;left:16px;bottom:72px;z-index:2147483647;max-width:360px;padding:10px 14px;border-radius:12px;'
    + 'background:#fff;color:#1A1F1B;font:14px/1.4 system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.2);display:none';
  document.body.append(btn, note);

  const say = (text, link) => {
    note.textContent = text;
    if (link) {
      const a = document.createElement('a');
      a.href = link; a.target = '_blank'; a.textContent = ' Открыть ↗'; a.style.color = '#4E6526';
      note.append(a);
    }
    note.style.display = 'block';
  };

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      say('Читаю список заказов…');
      const nums = await orderNumbers();
      const orders = [];
      for (const [i, n] of nums.entries()) {
        say(`Читаю заказ ${i + 1} из ${nums.length}…`);
        orders.push(await order(n));
      }
      say('Отправляю на склад…');
      const res = await chrome.runtime.sendMessage({ type: 'orders', shop: 'Ozon', orders });
      if (res.error) say(res.error);
      else say(`Готово: новых ${res.new}, обновлено ${res.updated}. Ждут разбора: ${res.inbox}.`, res.server + '/buy/inbox');
    } catch (e) {
      say('Не получилось: ' + e.message + '. Обновите страницу и попробуйте ещё раз; не помогло — Ozon поменял сайт.');
    } finally {
      btn.disabled = false;
    }
  });
})();
