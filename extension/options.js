const $ = (id) => document.getElementById(id);
const show = (text, ok) => { $('msg').textContent = text; $('msg').className = 'msg ' + (ok ? 'ok' : 'err'); };

chrome.storage.sync.get({ server: 'http://piserv.lan:8000', key: '' }).then((s) => {
  $('server').value = s.server;
  $('key').value = s.key;
});

$('save').addEventListener('click', async () => {
  let server = $('server').value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(server)) server = 'http://' + server;
  let origin;
  try { origin = new URL(server).origin; } catch (_) { show('Адрес склада не похож на адрес.', false); return; }
  // доступ к адресу склада, если он не из списка по умолчанию (спрашивает браузер)
  const granted = await chrome.permissions.request({ origins: [origin + '/*'] }).catch(() => false);
  if (!granted && !(await chrome.permissions.contains({ origins: [origin + '/*'] }))) {
    show('Без разрешения на адрес склада расширение не сможет отправлять заказы.', false);
    return;
  }
  const key = $('key').value.trim();
  if (!/^[!-~]+$/.test(key)) {   // ключ склада — латиница, цифры, «-» и «_»; другое браузер не отправит
    show(key ? 'Ключ не похож на ключ склада — скопируйте его заново в «Настройках» склада.' : 'Вставьте ключ.', false);
    return;
  }
  await chrome.storage.sync.set({ server, key });
  $('server').value = server;
  const res = await chrome.runtime.sendMessage({ type: 'ping' });
  if (res.error) show(res.error, false);
  else show(`Склад на связи. Ждут разбора: ${res.inbox}.`, true);
});
