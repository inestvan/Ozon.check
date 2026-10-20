// Сквозная проверка расширения в настоящем Chrome: Ozon подменён выдуманными заказами,
// склад — поддельный сервер здесь же (проверяем, что именно он получил). Профиль браузера временный.
// Запуск: npm test   (Chrome не в стандартном месте — CHROME=путь\chrome.exe npm test)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const EXT = path.resolve(__dirname, '..', 'extension');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const KEY = 'test-key-123';

// ---------- выдуманный Ozon: тот же JSON, что отдаёт /api/entrypoint-api.bx/page/json/v2 ----------
const W = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, JSON.stringify(v)]));
const product = (id, name, price, attrs = []) => ({
  title: { name: { text: name }, common: { action: { link: `/product/x-${id}/?is_apparel_size_selected=true`, id } } },
  attributes: attrs.map((t) => ({ text: t })), price: { price: [{ text: price }] },
});
const ship = (status, products) => ({ header: [{ type: 'textIcon', textIcon: { text: { text: status } } }],
  items: [{ sellers: [{ products }] }] });
const OZON = {
  '/my/orderlist?selectedTab=active': W({ 'orderList-1-default-1': { ordersV2: [
    { common: { action: { link: '/my/orderdetails/?order=555-0001' } } },
    { common: { action: { link: '/my/orderdetails/?order=555-0004' } } },
    { common: { action: { link: '/my/orderdetails/?order=555-0005' } } }] } }),
  '/my/orderlist?selectedTab=archive': W({ 'orderList-1-default-1': { ordersV2: [
    { common: { action: { link: '/my/orderdetails/?order=555-0002' } } },
    { common: { action: { link: '/my/orderdetails/?order=555-0003' } } }] } }),
  '/my/orderdetails/?order=555-0001': W({
    'titleWithTimer-1-default-1': { title: { text: 'Заказ от 18 октября' } },
    'orderDoneTotal-1-default-1': { total: { right: { price: { text: '1\u2009240 ₽' } } } },
    'shipmentWidget-1-default-1': ship('В пути', [product('123456', 'Плата Arduino Nano V3.0 ATmega328P', '840 ₽', ['Синий'])]),
    'shipmentWidget-2-default-1': ship('Отменён', [product('999', 'Отменённый товар', '400 ₽')]),
  }),
  '/my/orderdetails/?order=555-0002': W({
    'titleWithTimer-1-default-1': { title: { text: 'Заказ от 2 сентября' } },
    'orderDoneTotal-1-default-1': { total: { right: { price: { text: '400 ₽' } } } },
    'shipmentWidget-1-default-1': ship('Получен', [product('222', 'Винт M3x10 потайной DIN 965, 100 шт', '250 ₽'),
      product('333', 'Чехол для телефона', '150 ₽')]),
  }),
  '/my/orderdetails/?order=555-0004': W({   // среди «актуальных», но уже получен
    'titleWithTimer-1-default-1': { title: { text: 'Заказ от 15 октября' } },
    'shipmentWidget-1-default-1': ship('Получен', [product('555', 'Жидкое мыло', '686 ₽')]),
  }),
  '/my/orderdetails/?order=555-0005': W({   // «получения» — не «получен»
    'titleWithTimer-1-default-1': { title: { text: 'Заказ от 16 октября' } },
    'shipmentWidget-1-default-1': ship('Ожидает получения', [product('666', 'Разъём GX16-4', '120 ₽')]),
  }),
  '/my/orderdetails/?order=555-0003': W({
    'titleWithTimer-1-default-1': { title: { text: 'Заказ от 1 сентября' } },
    'shipmentWidget-1-default-1': ship('Отменён', [product('444', 'Что-то отменённое', '100 ₽')]),
  }),
};

// ---------- поддельный склад ----------
const got = [];
const sklad = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.headers['x-sklad-key'] !== KEY) return send(401, { error: 'Ключ не подходит — скопируйте его заново в «Настройках» склада.' });
    if (req.url === '/api/ping') return send(200, { ok: true, inbox: 0 });
    if (req.url === '/api/shop-orders') {
      const data = JSON.parse(body);
      got.push(data);
      return send(200, { ok: true, new: data.orders.length, updated: 0, inbox: data.orders.length });
    }
    send(404, { error: 'нет такого' });
  });
});

const step = (name) => console.log('✓', name);

(async () => {
  await new Promise((r) => sklad.listen(0, '127.0.0.1', r));
  const SERVER = `http://127.0.0.1:${sklad.address().port}`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ozon-check-'));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, enableExtensions: [EXT], pipe: true,
    userDataDir: profile, args: ['--no-first-run', '--no-default-browser-check'] });
  try {
    const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/background.js'), { timeout: 15000 });
    const id = new URL(sw.url()).host;
    step('расширение загрузилось');

    // настройки: адрес и ключ
    const opt = await browser.newPage();
    await opt.goto(`chrome-extension://${id}/options.html`);
    await opt.waitForFunction(() => document.getElementById('server').value !== '');
    assert.equal(await opt.$eval('#server', (e) => e.value), 'http://piserv.lan:8000');
    const save = async (key, server = SERVER) => {
      await opt.$eval('#msg', (e) => { e.textContent = ''; });
      await opt.$eval('#server', (e, s) => { e.value = s; }, server);
      await opt.$eval('#key', (e, k) => { e.value = k; }, key);
      await opt.click('#save');
      await opt.waitForFunction(() => document.getElementById('msg').textContent);
      return opt.$eval('#msg', (e) => [e.className, e.textContent]);
    };
    assert.match((await save('ключ'))[1], /не похож на ключ/);
    assert.match((await save('wrong'))[1], /Ключ не подходит/);
    assert.match((await save(KEY, 'http://127.0.0.1:1'))[1], /не отвечает/);
    const ok = await save(KEY);
    assert.equal(ok[0], 'msg ok', ok[1]);
    step('настройки: неверный ключ, недоступный склад, верный ключ');

    // Ozon: кнопка и отправка
    const oz = await browser.newPage();
    await oz.setRequestInterception(true);
    oz.on('request', (req) => {
      const u = new URL(req.url());
      if (u.hostname !== 'www.ozon.ru') return req.abort();   // никуда наружу
      if (u.pathname === '/api/entrypoint-api.bx/page/json/v2') {
        const states = OZON[u.searchParams.get('url')];
        return states ? req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ widgetStates: states }) })
          : req.respond({ status: 404, body: '' });
      }
      if (u.pathname.startsWith('/my/')) return req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><h1>Заказы</h1>' });
      return req.abort();
    });
    await oz.goto('https://www.ozon.ru/my/orderlist');
    await oz.waitForSelector('#sprut-send', { timeout: 10000 });
    const note = () => oz.evaluate(() => document.getElementById('sprut-send').nextSibling.textContent);
    // галочка «только в пути» в настройках расширения (сохраняется сразу при изменении)
    const toggle = async () => {
      await opt.$eval('#onlyWay', (e) => { e.checked = !e.checked; e.dispatchEvent(new Event('change')); });
      await new Promise((r) => setTimeout(r, 300));
    };
    const press = async () => {
      await oz.bringToFront();
      await oz.evaluate(() => { document.getElementById('sprut-send').nextSibling.textContent = ''; });
      await oz.click('#sprut-send');
      await oz.waitForFunction(() => /Готово|Не получилось|нечего/.test(document.getElementById('sprut-send').nextSibling?.textContent || ''), { timeout: 20000 });
      return note();
    };

    // по умолчанию — только в пути: полученный 555-0004 и завершённые не уходят
    assert.equal(await opt.$eval('#onlyWay', (e) => e.checked), true);
    assert.match(await press(), /Готово \(в пути: 2\): новых 2/);
    assert.deepEqual(got[0].orders.map((o) => o.number), ['555-0001', '555-0005']);
    assert.equal(got[0].orders[1].status, 'Ожидает получения');
    step('«только в пути» (по умолчанию): полученные не отправлены, «Ожидает получения» — отправлен');

    // галочку сняли — все заказы, и завершённые тоже
    await toggle();
    assert.match(await press(), /Готово: новых 5/);
    step('без галочки: все заказы');

    // что получил склад
    assert.equal(got.length, 2);
    const { shop, orders } = got[1];
    assert.equal(shop, 'Ozon');
    assert.deepEqual(orders.map((o) => o.number), ['555-0001', '555-0004', '555-0005', '555-0002', '555-0003']);
    const [o1, , , o2, o3] = orders;
    const year = new Date().getFullYear();
    assert.equal(o1.date, `${new Date().getMonth() + 1 < 10 ? year - 1 : year}-10-18`);
    assert.equal(o1.amount, 1240);
    assert.equal(o1.status, 'В пути · Отменён');
    assert.deepEqual(o1.items, [{ sku: '123456', name: 'Плата Arduino Nano V3.0 ATmega328P', variant: 'Синий',
      url: 'https://www.ozon.ru/product/x-123456/', price: 840, qty: 1 }]);   // отменённое отправление не попало
    assert.equal(o2.status, 'Получен');
    assert.deepEqual(o2.items.map((i) => [i.sku, i.price]), [['222', 250], ['333', 150]]);
    assert.equal(o3.items.length, 0);
    step('склад получил: номера, даты, суммы, статусы, товары (без отменённых)');

    // в пути ничего — на склад не ходим
    await toggle();
    for (const n of ['555-0001', '555-0005']) OZON[`/my/orderdetails/?order=${n}`] = OZON['/my/orderdetails/?order=555-0004'];
    assert.match(await press(), /Заказов в пути нет/);
    assert.equal(got.length, 2);
    step('в пути ничего — «отправлять нечего», склад не трогается');
    console.log('\nВсё работает.');
  } catch (e) {
    console.error('\n✗', e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
    sklad.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})();
