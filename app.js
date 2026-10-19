/* ============================================================
   MarketScan — PWA Market Barkod Tarayıcı (fiyat geçmişi)
   ============================================================ */

const $  = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const CONFIG = {
  DEBOUNCE_MS: 1500,
  DETECT_INTERVAL_MS: 150,
  BARCODE_FORMATS: [
    'ean_13', 'ean_8', 'upc_a', 'upc_e',
    'code_128', 'code_39', 'itf', 'codabar'
  ]
};

const state = {
  mode: 'single',
  products: [],
  cart: [],
  stream: null,
  detector: null,
  videoTrack: null,
  running: false,
  lastBarcode: null,
  lastBarcodeTime: 0,
  supported: false
};

const els = {
  video: $('#video'),
  cameraFrame: $('#cameraFrame'),
  cameraStatus: $('#cameraStatus'),
  scanOverlay: $('#scanOverlay'),
  startCameraBtn: $('#startCameraBtn'),
  stopCameraBtn: $('#stopCameraBtn'),
  supportHint: $('#supportHint'),
  manualForm: $('#manualForm'),
  manualInput: $('#manualInput'),
  errorMsg: $('#errorMsg'),
  infoMsg: $('#infoMsg'),
  singleResult: $('#singleResult'),
  cartSection: $('#cartSection'),
  cartList: $('#cartList'),
  cartCount: $('#cartCount'),
  emptyCart: $('#emptyCart'),
  totalBar: $('#totalBar'),
  totalCount: $('#totalCount'),
  totalPrice: $('#totalPrice'),
  clearCartBtn: $('#clearCartBtn'),
  swIndicator: $('#swIndicator')
};

function formatPrice(n) {
  return n.toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }) + ' ₺';
}

function showError(msg) {
  els.errorMsg.textContent = msg;
  els.errorMsg.hidden = false;
  els.infoMsg.hidden = true;
  clearTimeout(showError._t);
  showError._t = setTimeout(() => { els.errorMsg.hidden = true; }, 5000);
}

function showInfo(msg) {
  els.infoMsg.textContent = msg;
  els.infoMsg.hidden = false;
  els.errorMsg.hidden = true;
  clearTimeout(showInfo._t);
  showInfo._t = setTimeout(() => { els.infoMsg.hidden = true; }, 3000);
}

function clearMessages() {
  els.errorMsg.hidden = true;
  els.infoMsg.hidden = true;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function loadProducts() {
  try {
    const res = await fetch('./products.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('products.json yüklenemedi');
    const data = await res.json();
    state.products = Array.isArray(data.products) ? data.products : [];
    console.log(`[MarketScan] ${state.products.length} ürün yüklendi.`);
  } catch (err) {
    console.error(err);
    state.products = [];
    showError('Ürün verisi yüklenemedi. Bağlantını kontrol edip sayfayı yenile.');
  }
}

function findProduct(barcode) {
  const normalized = String(barcode).trim();
  return state.products.find((p) => String(p.barcode) === normalized) || null;
}

const HISTORY_KEY = 'marketscan-price-history';
const HISTORY_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 365;

function loadPriceHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function savePriceHistory(history) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch (e) {
    console.warn('Fiyat geçmişi kaydedilemedi:', e);
  }
}

function getPreviousPrice(barcode) {
  const history = loadPriceHistory();
  const entry = history[barcode];
  if (!entry) return null;
  if (Date.now() - entry.timestamp > HISTORY_MAX_AGE_MS) return null;
  return entry;
}

function recordPrice(barcode, price) {
  const history = loadPriceHistory();
  history[barcode] = {
    price: Number(price),
    timestamp: Date.now()
  };
  savePriceHistory(history);
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  const min = Math.floor(sec / 60);
  const hour = Math.floor(min / 60);
  const day = Math.floor(hour / 24);
  const week = Math.floor(day / 7);
  const month = Math.floor(day / 30);
  const year = Math.floor(day / 365);

  if (sec < 60) return 'az önce';
  if (min < 60) return `${min} dakika önce`;
  if (hour < 24) return `${hour} saat önce`;
  if (day === 1) return 'dün';
  if (day < 7) return `${day} gün önce`;
  if (week === 1) return '1 hafta önce';
  if (week < 4) return `${week} hafta önce`;
  if (month === 1) return '1 ay önce';
  if (month < 12) return `${month} ay önce`;
  if (year === 1) return '1 yıl önce';
  return `${year} yıl önce`;
}

function buildPriceHistoryNotification(product) {
  const prev = getPreviousPrice(product.barcode);
  if (!prev) return null;

  const oldPrice = prev.price;
  const newPrice = Number(product.price);
  const delta = newPrice - oldPrice;
  const percent = oldPrice > 0 ? (delta / oldPrice) * 100 : 0;
  const when = timeAgo(prev.timestamp);

  let type, icon, message;

  if (Math.abs(delta) < 0.01) {
    type = 'same';
    icon = '➖';
    message = `Bu ürünü <strong>${when}</strong> okuttuğunuzda fiyatı <strong>${formatPrice(oldPrice)}</strong> idi. Fiyat <strong>değişmedi</strong>.`;
  } else if (delta > 0) {
    type = 'rise';
    icon = '📈';
    message = `Bu ürünü <strong>${when}</strong> okuttuğunuzda fiyatı <strong>${formatPrice(oldPrice)}</strong> idi. Şimdi <strong>${formatPrice(newPrice)}</strong> olmuş.` +
      `<span class="ph-delta">+${formatPrice(delta)} (%${percent.toFixed(1)} artış)</span>`;
  } else {
    type = 'fall';
    icon = '📉';
    message = `Bu ürünü <strong>${when}</strong> okuttuğunuzda fiyatı <strong>${formatPrice(oldPrice)}</strong> idi. Şimdi <strong>${formatPrice(newPrice)}</strong> olmuş.` +
      `<span class="ph-delta">${formatPrice(delta)} (%${Math.abs(percent).toFixed(1)} düşüş)</span>`;
  }

  return {
    type,
    icon,
    html: `
      <div class="ph-icon">${icon}</div>
      <div class="ph-text">
        ${message}
        <span class="ph-when">Son okutma: ${when}</span>
      </div>
    `
  };
}

function handleBarcode(rawValue, source = 'camera') {
  const barcode = String(rawValue || '').trim();
  if (!barcode) return;

  if (source === 'camera') {
    const now = Date.now();
    if (barcode === state.lastBarcode && now - state.lastBarcodeTime < CONFIG.DEBOUNCE_MS) {
      return;
    }
    state.lastBarcode = barcode;
    state.lastBarcodeTime = now;
  }

  if (navigator.vibrate) navigator.vibrate(60);

  const product = findProduct(barcode);

  if (!product) {
    if (state.mode === 'single') {
      els.singleResult.hidden = true;
    }
    showError(`Ürün bulunamadı. (Barkod: ${barcode})`);
    return;
  }

  clearMessages();

  if (state.mode === 'single') {
    renderSingleResult(product);
  } else {
    addToCart(product);
    recordPrice(product.barcode, product.price);
  }
}

function renderSingleResult(product) {
  const historyNotif = buildPriceHistoryNotification(product);
  recordPrice(product.barcode, product.price);

  const notifHtml = historyNotif
    ? `<div class="price-history ${historyNotif.type}">${historyNotif.html}</div>`
    : '';

  els.singleResult.innerHTML = `
    <div class="product-card-header">
      <span class="product-category">${escapeHtml(product.category)}</span>
      <span class="product-barcode">${escapeHtml(String(product.barcode))}</span>
    </div>
    <div class="product-card-body">
      <h3 class="product-name">${escapeHtml(product.name)}</h3>
      <p class="product-brand">${escapeHtml(product.brand)}</p>

      ${notifHtml}

      <div class="product-meta">
        <div class="meta-box">
          <span class="meta-label">Marka</span>
          <span class="meta-value">${escapeHtml(product.brand)}</span>
        </div>
        <div class="meta-box">
          <span class="meta-label">Miktar</span>
          <span class="meta-value">${escapeHtml(product.quantity)}</span>
        </div>
        <div class="meta-box">
          <span class="meta-label">Kategori</span>
          <span class="meta-value">${escapeHtml(product.category)}</span>
        </div>
        <div class="meta-box">
          <span class="meta-label">Barkod</span>
          <span class="meta-value" style="font-size:0.8rem;font-variant-numeric:tabular-nums">${escapeHtml(String(product.barcode))}</span>
        </div>
      </div>

      <div class="product-price">
        <span class="price-label">Fiyat</span>
        <span class="price-value">${formatPrice(product.price)}</span>
      </div>
    </div>
  `;
  els.singleResult.hidden = false;
}

function addToCart(product) {
  state.cart.push({
    ...product,
    _id: Date.now() + '-' + Math.random().toString(36).slice(2, 7)
  });
  renderCart();
}

function removeFromCart(id) {
  state.cart = state.cart.filter((it) => it._id !== id);
  renderCart();
}

function clearCart() {
  if (state.cart.length === 0) return;
  if (!confirm('Sepeti tamamen temizlemek istiyor musun?')) return;
  state.cart = [];
  renderCart();
  showInfo('Sepet temizlendi.');
}

function renderCart() {
  els.cartList.innerHTML = '';

  if (state.cart.length === 0) {
    els.emptyCart.hidden = false;
  } else {
    els.emptyCart.hidden = true;
    state.cart.forEach((it) => {
      const li = document.createElement('li');
      li.className = 'cart-item';
      li.innerHTML = `
        <div class="cart-item-info">
          <span class="cart-item-name">${escapeHtml(it.name)}</span>
          <span class="cart-item-sub">${escapeHtml(it.brand)} · ${escapeHtml(it.quantity)}</span>
        </div>
        <span class="cart-item-price">${formatPrice(it.price)}</span>
        <button class="cart-item-remove" type="button" aria-label="Ürünü çıkar" data-remove="${it._id}">×</button>
      `;
      els.cartList.appendChild(li);
    });
  }

  const total = state.cart.reduce((sum, it) => sum + Number(it.price || 0), 0);
  const count = state.cart.length;

  els.cartCount.textContent = `${count} ürün`;
  els.totalCount.textContent = `${count} ürün`;
  els.totalPrice.textContent = formatPrice(total);

  els.cartList.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', () => removeFromCart(btn.dataset.remove));
  });
}

function setMode(mode) {
  state.mode = mode;

  $$('.tab').forEach((t) => {
    const active = t.dataset.mode === mode;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  if (mode === 'single') {
    els.singleResult.hidden = true;
    els.cartSection.hidden = true;
    els.totalBar.hidden = true;
  } else {
    els.cartSection.hidden = false;
    els.totalBar.hidden = false;
    renderCart();
  }

  state.lastBarcode = null;
  state.lastBarcodeTime = 0;
}

$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => setMode(tab.dataset.mode));
});

async function checkSupport() {
  if (!('BarcodeDetector' in window)) {
    state.supported = false;
    els.supportHint.textContent = '⚠️ Bu tarayıcı BarcodeDetector API\'sini desteklemiyor. Elle barkod girişi kullanabilirsin.';
    els.supportHint.classList.add('warn');
    els.startCameraBtn.disabled = true;
    return false;
  }

  try {
    const supported = await BarcodeDetector.getSupportedFormats();
    const usable = CONFIG.BARCODE_FORMATS.filter((f) => supported.includes(f));

    if (usable.length === 0) {
      state.supported = false;
      els.supportHint.textContent = '⚠️ Cihaz hiçbir klasik barkod formatını desteklemiyor. Elle giriş kullanabilirsin.';
      els.supportHint.classList.add('warn');
      els.startCameraBtn.disabled = true;
      return false;
    }

    state.detector = new BarcodeDetector({ formats: usable });
    state.supported = true;
    els.supportHint.textContent = `Desteklenen formatlar: ${usable.join(', ')}`;
    return true;
  } catch (err) {
    console.error(err);
    state.supported = false;
    els.supportHint.textContent = '⚠️ Barkod okuyucu başlatılamadı. Elle giriş kullanabilirsin.';
    els.supportHint.classList.add('warn');
    els.startCameraBtn.disabled = true;
    return false;
  }
}

async function startCamera() {
  clearMessages();

  if (!navigator.mediaDevices?.getUserMedia) {
    showError('Bu tarayıcı kamera erişimini desteklemiyor.');
    return;
  }

  if (!state.supported) {
    showError('Barkod okuyucu bu cihazda kullanılamıyor. Elle giriş yapabilirsin.');
    return;
  }

  setCameraStatus('Kamera başlatılıyor…');

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width:  { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });

    state.stream = stream;
    state.videoTrack = stream.getVideoTracks()[0];
    els.video.srcObject = stream;
    await els.video.play().catch(() => {});

    els.video.addEventListener('loadedmetadata', onVideoReady, { once: true });
    if (els.video.readyState >= 2) onVideoReady();

  } catch (err) {
    handleCameraError(err);
  }
}

function onVideoReady() {
  hideCameraStatus();
  els.scanOverlay.hidden = false;
  els.startCameraBtn.disabled = true;
  els.stopCameraBtn.disabled = false;
  state.running = true;
  state.lastBarcode = null;
  state.lastBarcodeTime = 0;
  detectLoop();
}

function stopCamera() {
  state.running = false;
  els.scanOverlay.hidden = true;
  els.startCameraBtn.disabled = false;
  els.stopCameraBtn.disabled = true;

  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }
  if (els.video) els.video.srcObject = null;
  state.videoTrack = null;

  setCameraStatus('Kamera kapalı');
}

function setCameraStatus(text, isError = false) {
  els.cameraStatus.textContent = text;
  els.cameraStatus.classList.remove('hidden');
  els.cameraStatus.classList.toggle('error', isError);
}

function hideCameraStatus() {
  els.cameraStatus.classList.add('hidden');
  els.cameraStatus.classList.remove('error');
}

function handleCameraError(err) {
  console.error('[Kamera]', err);

  let msg = 'Kamera başlatılamadı.';
  if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
    msg = 'Kamera izni reddedildi. Tarayıcı ayarlarından izin verip tekrar dene.';
  } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
    msg = 'Cihazda kullanılabilir kamera bulunamadı.';
  } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
    msg = 'Kamera başka bir uygulama tarafından kullanılıyor.';
  } else if (err.name === 'OverconstrainedError') {
    msg = 'Kamera bu çözünürlüğü desteklemiyor.';
  } else if (err.name === 'SecurityError') {
    msg = 'Güvenlik nedeniyle kameraya erişilemedi (HTTPS gerekli).';
  } else if (err.message) {
    msg = 'Kamera hatası: ' + err.message;
  }

  setCameraStatus(msg, true);
  showError(msg);
}

let lastDetectAt = 0;

async function detectLoop() {
  if (!state.running || !state.detector) return;

  const now = performance.now();
  if (now - lastDetectAt >= CONFIG.DETECT_INTERVAL_MS) {
    lastDetectAt = now;

    if (els.video.readyState >= 2) {
      try {
        const results = await state.detector.detect(els.video);
        if (results && results.length > 0) {
          const best = results.reduce((a, b) =>
            (String(b.rawValue).length > String(a.rawValue).length ? b : a)
          );
          handleBarcode(best.rawValue, 'camera');
        }
      } catch (err) {}
    }
  }

  requestAnimationFrame(detectLoop);
}

els.manualForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const val = els.manualInput.value.trim();
  if (!val) return;
  handleBarcode(val, 'manual');
  els.manualInput.value = '';
  els.manualInput.blur();
});

els.manualInput.addEventListener('input', () => {
  els.manualInput.value = els.manualInput.value.replace(/\D/g, '');
});

els.startCameraBtn.addEventListener('click', startCamera);
els.stopCameraBtn.addEventListener('click', stopCamera);
els.clearCartBtn.addEventListener('click', clearCart);

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.running) {
    stopCamera();
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        console.log('[SW] Kayıtlı:', reg.scope);
        els.swIndicator.classList.add('on');
      })
      .catch((err) => console.error('[SW] Hata:', err));
  });
}

window.addEventListener('offline', () => {
  showInfo('⚡ Çevrimdışısın. Uygulama çalışmaya devam eder, ancak tarama için kamera gerekir.');
});
window.addEventListener('online', () => {
  clearMessages();
});

(async function init() {
  await loadProducts();
  await checkSupport();
  setMode('single');
  renderCart();
})();