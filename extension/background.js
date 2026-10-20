// Отправка на склад идёт отсюда: страница Ozon открыта по https, а склад дома — по http,
// из самой страницы такой запрос браузер не пустит.
const DEFAULT_SERVER = 'http://piserv.lan:8000';

async function settings() {
  const s = await chrome.storage.sync.get({ server: DEFAULT_SERVER, key: '' });
  return { server: s.server.replace(/\/+$/, ''), key: s.key.trim() };
}

async function post(path, body) {
  const { server, key } = await settings();
  if (!key) return { error: 'Нет ключа склада — нажмите значок расширения и вставьте ключ из «Настроек» склада.' };
  let r;
  try {
    r = await fetch(server + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Sklad-Key': key },
      body: JSON.stringify(body || {}),
    });
  } catch (e) {
    return { error: `Склад не отвечает (${server}). Вы в домашней сети? Адрес верный?` };
  }
  let data = {};
  try { data = await r.json(); } catch (_) {}
  if (!r.ok) return { error: data.error || `Склад ответил ошибкой ${r.status}.` };
  return { ...data, server };
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg && msg.type === 'orders') post('/api/shop-orders', { shop: msg.shop, orders: msg.orders }).then(reply);
  else if (msg && msg.type === 'ping') post('/api/ping').then(reply);
  else return false;
  return true;   // ответ придёт позже
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
