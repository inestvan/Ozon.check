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

  // «Получен», «Доставлен» — но не «Ожидает получения»
  const DONE = /^\s*(получен|доставлен|вручен|выдан)(?![а-яё])/i;

  async function orderNumbers(tabs) {
    const nums = [];
    for (const tab of tabs) {
      const states = await page('/my/orderlist?selectedTab=' + tab);
      for (const n of JSON.stringify(states).match(/order=\d+-\d+/g) || []) nums.push(n.slice(6));
    }
    return [...new Set(nums)];
  }

  async function order(number, onlyWay) {
    const states = await page('/my/orderdetails/?order=' + number);
    const title = widgets(states, 'titleWithTimer')[0]?.title?.text || '';
    const total = widgets(states, 'orderDoneTotal')[0]?.total?.right?.price?.text;
    const items = [];
    const status = [];
    for (const s of widgets(states, 'shipmentWidget')) {
      const head = (s.header || []).find((h) => h.type === 'textIcon')?.textIcon?.text?.text;
      if (head) status.push(head);
      if (/отмен/i.test(head || '')) continue;   // отменённая часть заказа — не приедет
      if (onlyWay && DONE.test(head || '')) continue;   // уже получено — не нужно
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
          image: p.picture?.image?.image || p.pictureV2?.productMedia?.image?.url || '',
        });
      }
    }
    return {
      number, date: parseDate(title), status: [...new Set(status)].join(' · '), amount: money(total),
      url: 'https://www.ozon.ru/my/orderdetails/?order=' + number, items,
    };
  }

  // Вид — как у склада (стиль «Мастерская»): оливковая кнопка, белая карточка, зелёное/красное сообщение
  const FONT = "Onest, 'Segoe UI', system-ui, sans-serif";
  const LOOK = {
    info: 'background:#FFFFFF;color:#1A1F1B;border:1px solid #CDD3CA',
    ok: 'background:#DDEFDF;color:#1F5A2B;border:1px solid #B9D3B4',
    err: 'background:#FDF3F2;color:#8C1D17;border:1px solid #E8B4AF',
  };
  const btn = document.createElement('button');
  btn.id = 'sprut-send';
  btn.textContent = '📦 В склад СПРУТ';
  btn.title = 'Отправить заказы во «Входящие заказы» склада';
  btn.style.cssText = `position:fixed;left:16px;bottom:16px;z-index:2147483647;min-height:42px;padding:0 16px;border:1px solid #4E6526;`
    + `border-radius:10px;background:#4E6526;color:#fff;font:600 14px ${FONT};box-shadow:0 6px 20px rgba(26,31,27,.25);cursor:pointer`;
  btn.addEventListener('mouseenter', () => { btn.style.background = '#33441A'; });
  btn.addEventListener('mouseleave', () => { btn.style.background = '#4E6526'; });
  const note = document.createElement('div');
  document.body.append(btn, note);

  const say = (text, link, kind = 'info') => {
    note.style.cssText = `position:fixed;left:16px;bottom:68px;z-index:2147483647;max-width:360px;padding:12px 16px;border-radius:12px;`
      + `font:600 14px/1.45 ${FONT};box-shadow:0 6px 24px rgba(26,31,27,.18);${LOOK[kind]}`;
    note.textContent = text;
    if (link) {
      const a = document.createElement('a');
      a.href = link; a.target = '_blank'; a.textContent = ' Открыть ↗';
      a.style.cssText = 'color:#4E6526;text-decoration:underline;text-underline-offset:2px';
      note.append(a);
    }
  };

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const { onlyWay } = await chrome.storage.sync.get({ onlyWay: true });
      say('Читаю список заказов…');
      // завершённые — только если нужны и полученные
      const nums = await orderNumbers(onlyWay ? ['active'] : ['active', 'archive']);
      let orders = [];
      for (const [i, n] of nums.entries()) {
        say(`Читаю заказ ${i + 1} из ${nums.length}…`);
        orders.push(await order(n, onlyWay));
      }
      if (onlyWay) orders = orders.filter((o) => o.items.length);
      if (!orders.length) {
        say(onlyWay ? 'Заказов в пути нет — отправлять нечего.' : 'Заказов нет.', null, 'ok');
        return;
      }
      say('Отправляю на склад…');
      const res = await chrome.runtime.sendMessage({ type: 'orders', shop: 'Ozon', orders });
      if (res.error) say(res.error, null, 'err');
      else say(`Готово${onlyWay ? ` (в пути: ${orders.length})` : ''}: новых ${res.new}, обновлено ${res.updated}. Ждут разбора: ${res.inbox}.`,
        res.server + '/buy/inbox', 'ok');
    } catch (e) {
      say('Не получилось: ' + e.message + '. Обновите страницу и попробуйте ещё раз; не помогло — Ozon поменял сайт.', null, 'err');
    } finally {
      btn.disabled = false;
    }
  });
})();
