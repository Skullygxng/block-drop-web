/* Block Drop — decoy game, secret code pad, hidden vault. All client-side. */
(() => {
  'use strict';

  // ---------- Constants ----------
  const TILE_COLORS = ['#29d3c7', '#fa9e21', '#f55c5c', '#4d8cf2', '#9e70eb', '#facc38'];
  const START_TIME = 2.0;     // seconds for the first round
  const TIME_FACTOR = 0.94;   // round time multiplier per hit
  const MIN_TIME = 0.6;       // round time floor
  const COMBO_TAPS = 5;       // title taps to reveal the pad
  const COMBO_WINDOW = 1200;  // ms
  const BEST_KEY = 'bd_best'; // best score
  const CODE_KEY = 'bd_k';    // salted SHA-256 of the access code
  const DB_NAME = 'bdsave';   // deliberately nondescript
  const STORE = 'levels';     // deliberately nondescript

  const $ = (id) => document.getElementById(id);

  // ---------- Elements ----------
  const gameScreen = $('gameScreen');
  const padOverlay = $('padOverlay');
  const vaultScreen = $('vaultScreen');
  const viewer = $('viewer');

  const titleEl = $('gameTitle');
  const scoreVal = $('scoreVal');
  const bestVal = $('bestVal');
  const livesEl = $('lives');
  const barTrack = $('barTrack');
  const barFill = $('barFill');
  const gridEl = $('grid');
  const startCard = $('startCard');
  const overCard = $('overCard');
  const overStats = $('overStats');

  const padHint = $('padHint');
  const dotsEl = $('dots');
  const keypadEl = $('keypad');
  const dotEls = Array.from(dotsEl.children);

  const lockBtn = $('lockBtn');
  const menuBtn = $('menuBtn');
  const menuEl = $('menu');
  const thumbGrid = $('thumbGrid');
  const emptyState = $('emptyState');
  const plusBtn = $('plusBtn');
  const importingPill = $('importing');
  const fileInput = $('fileInput');

  const viewerImg = $('viewerImg');
  const viewerVideo = $('viewerVideo');

  // ---------- Game ----------
  const tiles = [];
  let playing = false;
  let score = 0;
  let lives = 3;
  let roundTime = START_TIME;
  let roundStart = 0;
  let targetIndex = -1;
  let rafId = 0;
  let best = Number(localStorage.getItem(BEST_KEY) || 0) || 0;
  bestVal.textContent = String(best);

  for (let i = 0; i < 16; i++) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'tile';
    tile.addEventListener('click', () => tapTile(i));
    gridEl.appendChild(tile);
    tiles.push(tile);
  }

  function renderLives() {
    Array.from(livesEl.children).forEach((dot, i) => {
      dot.classList.toggle('lost', i >= lives);
    });
  }

  function paintRound() {
    targetIndex = Math.floor(Math.random() * tiles.length);
    tiles.forEach((tile, i) => {
      tile.style.background = TILE_COLORS[Math.floor(Math.random() * TILE_COLORS.length)];
      tile.classList.toggle('target', i === targetIndex);
    });
  }

  function startGame() {
    score = 0;
    lives = 3;
    roundTime = START_TIME;
    playing = true;
    scoreVal.textContent = '0';
    renderLives();
    startCard.hidden = true;
    overCard.hidden = true;
    barTrack.hidden = false;
    newRound();
  }

  function newRound() {
    paintRound();
    roundStart = performance.now();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
  }

  function tick(now) {
    const left = roundTime - (now - roundStart) / 1000;
    if (left <= 0) {
      barFill.style.width = '0%';
      loseLife();
      return;
    }
    barFill.style.width = (left / roundTime) * 100 + '%';
    rafId = requestAnimationFrame(tick);
  }

  function tapTile(i) {
    if (!playing) return;
    if (i === targetIndex) {
      score++;
      scoreVal.textContent = String(score);
      roundTime = Math.max(MIN_TIME, roundTime * TIME_FACTOR);
      newRound();
    } else {
      const tile = tiles[i];
      tile.classList.remove('wrong');
      void tile.offsetWidth; // restart the animation
      tile.classList.add('wrong');
      loseLife();
    }
  }

  function loseLife() {
    lives--;
    renderLives();
    if (lives <= 0) endGame();
    else newRound();
  }

  function stopGame() {
    playing = false;
    cancelAnimationFrame(rafId);
    barTrack.hidden = true;
    startCard.hidden = false;
  }

  function endGame() {
    playing = false;
    cancelAnimationFrame(rafId);
    barTrack.hidden = true;
    if (score > best) {
      best = score;
      localStorage.setItem(BEST_KEY, String(best));
      bestVal.textContent = String(best);
    }
    overStats.textContent = 'Score ' + score + ' · Best ' + best;
    overCard.hidden = false;
  }

  $('playBtn').addEventListener('click', startGame);
  $('againBtn').addEventListener('click', startGame);

  // ---------- Secret combo (5 title taps in 1.2 s) ----------
  let taps = [];

  titleEl.addEventListener('click', () => {
    if (gameScreen.hidden || !vaultScreen.hidden) return;
    const now = Date.now();
    taps.push(now);
    taps = taps.filter((t) => now - t <= COMBO_WINDOW);
    titleEl.classList.add('pop');
    setTimeout(() => titleEl.classList.remove('pop'), 110);
    if (taps.length >= COMBO_TAPS) {
      taps = [];
      openPad(hasCode() ? 'unlock' : 'setup');
    }
  });

  // ---------- Code pad ----------
  // The code itself is never stored: only SHA-256 of "<salt>:<digits>".
  const pad = { flow: 'unlock', stage: 'enter', digits: [], pending: null, busy: false };

  function readCodeRecord() {
    try {
      const raw = localStorage.getItem(CODE_KEY);
      if (!raw) return null;
      const rec = JSON.parse(raw);
      return rec && typeof rec.s === 'string' && typeof rec.h === 'string' ? rec : null;
    } catch (err) {
      return null;
    }
  }

  function hasCode() {
    return readCodeRecord() !== null;
  }

  function randomSalt() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function hashCode(digits, salt) {
    const data = new TextEncoder().encode(salt + ':' + digits);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function padHintText() {
    if (pad.flow === 'setup') {
      return pad.stage === 'first' ? 'Choose a 4-digit code' : 'Confirm your code';
    }
    return 'Enter access code';
  }

  function renderDots(state) {
    dotEls.forEach((dot, i) => {
      dot.className = 'dot';
      if (state === 'ok') dot.classList.add('ok');
      else if (i < pad.digits.length) dot.classList.add('filled');
    });
  }

  function updatePad() {
    padHint.textContent = padHintText();
    renderDots();
  }

  function openPad(flow) {
    pad.flow = flow;
    pad.stage = flow === 'setup' ? 'first' : 'enter';
    pad.digits = [];
    pad.pending = null;
    pad.busy = false;
    updatePad();
    padOverlay.hidden = false;
  }

  function closePad() {
    padOverlay.hidden = true;
    pad.busy = false;
  }

  function shakeDots() {
    dotsEl.classList.remove('shake');
    void dotsEl.offsetWidth;
    dotsEl.classList.add('shake');
  }

  function padSuccess(then) {
    pad.busy = true;
    renderDots('ok');
    setTimeout(() => {
      closePad();
      then();
    }, 420);
  }

  async function submitPad() {
    const entered = pad.digits.join('');
    if (pad.flow === 'setup') {
      if (pad.stage === 'first') {
        pad.pending = entered;
        pad.stage = 'confirm';
        pad.digits = [];
        updatePad();
        return;
      }
      if (entered === pad.pending) {
        const salt = randomSalt();
        const h = await hashCode(entered, salt);
        localStorage.setItem(CODE_KEY, JSON.stringify({ s: salt, h: h }));
        padSuccess(openVault);
      } else {
        shakeDots();
        pad.stage = 'first';
        pad.pending = null;
        pad.digits = [];
        setTimeout(() => {
          padHint.textContent = padHintText();
          renderDots();
        }, 400);
      }
    } else {
      const rec = readCodeRecord();
      const h = rec ? await hashCode(entered, rec.s) : '';
      if (rec && h === rec.h) {
        padSuccess(openVault);
      } else {
        shakeDots();
        pad.digits = [];
        setTimeout(renderDots, 400);
      }
    }
  }

  keypadEl.addEventListener('click', (e) => {
    const key = e.target.closest('.key[data-k]');
    if (!key || pad.busy) return;
    const k = key.dataset.k;
    if (k === 'back') {
      pad.digits.pop();
      renderDots();
      return;
    }
    if (pad.digits.length >= 4) return;
    pad.digits.push(k);
    renderDots();
    if (pad.digits.length === 4) submitPad();
  });

  $('padCancel').addEventListener('click', closePad);

  // ---------- Vault storage (IndexedDB, nondescript names) ----------
  let dbPromise = null;

  function getDB() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  function dbRequest(mode, action) {
    return getDB().then((db) => new Promise((resolve, reject) => {
      const req = action(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  }

  const dbAll = () => dbRequest('readonly', (s) => s.getAll());
  const dbAdd = (rec) => dbRequest('readwrite', (s) => s.add(rec));
  const dbDelete = (id) => dbRequest('readwrite', (s) => s.delete(id));
  const dbClear = () => dbRequest('readwrite', (s) => s.clear());

  // ---------- Vault rendering ----------
  const objectUrls = [];

  function trackUrl(url) {
    objectUrls.push(url);
    return url;
  }

  function revokeUrls() {
    while (objectUrls.length) URL.revokeObjectURL(objectUrls.pop());
  }

  function makeVideoThumb(blob) {
    return new Promise((resolve) => {
      const src = URL.createObjectURL(blob);
      const vid = document.createElement('video');
      vid.muted = true;
      vid.playsInline = true;
      vid.preload = 'metadata';
      let done = false;

      const finish = (canvas) => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        vid.removeAttribute('src');
        vid.load();
        URL.revokeObjectURL(src);
        if (!canvas) {
          resolve(null);
          return;
        }
        canvas.toBlob((b) => {
          resolve(b ? trackUrl(URL.createObjectURL(b)) : null);
        }, 'image/jpeg', 0.8);
      };

      const timeout = setTimeout(() => finish(null), 6000);

      vid.onloadedmetadata = () => {
        const duration = isFinite(vid.duration) && vid.duration > 0 ? vid.duration : 1;
        vid.currentTime = Math.min(0.5, duration * 0.5);
      };
      vid.onseeked = () => {
        if (!vid.videoWidth) {
          finish(null);
          return;
        }
        const w = Math.min(480, vid.videoWidth);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = Math.round((w * vid.videoHeight) / vid.videoWidth);
        canvas.getContext('2d').drawImage(vid, 0, 0, canvas.width, canvas.height);
        finish(canvas);
      };
      vid.onerror = () => finish(null);

      vid.src = src;
    });
  }

  async function renderVault() {
    revokeUrls();
    thumbGrid.innerHTML = '';
    let items = [];
    try {
      items = await dbAll();
    } catch (err) {
      items = [];
    }
    emptyState.hidden = items.length > 0;
    emptyState.style.position = items.length > 0 ? 'static' : 'absolute';

    for (const item of items) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'thumb';
      cell.addEventListener('click', () => openViewer(item));

      let media = null;
      if (item.type.startsWith('image/')) {
        media = document.createElement('img');
        media.src = trackUrl(URL.createObjectURL(item.blob));
        media.alt = '';
      } else if (item.type.startsWith('video/')) {
        const url = await makeVideoThumb(item.blob);
        if (url) {
          media = document.createElement('img');
          media.src = url;
          media.alt = '';
        } else {
          media = document.createElement('div');
          media.className = 'thumb-fallback';
          media.innerHTML =
            '<svg viewBox="0 0 24 24"><path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm6 4v6l6-3-6-3z"/></svg>';
        }
      }
      if (media) cell.appendChild(media);
      thumbGrid.appendChild(cell);
    }
  }

  // ---------- Import ----------
  let suppressAutoLock = false;

  plusBtn.addEventListener('click', () => {
    suppressAutoLock = true; // the native file dialog steals focus; don't re-lock for it
    fileInput.click();
  });

  fileInput.addEventListener('cancel', () => {
    suppressAutoLock = false;
  });

  fileInput.addEventListener('change', async () => {
    suppressAutoLock = false;
    const files = Array.from(fileInput.files || []);
    fileInput.value = '';
    if (!files.length) return;
    importingPill.hidden = false;
    plusBtn.disabled = true;
    try {
      for (const file of files) {
        await dbAdd({ type: file.type || '', blob: file, added: Date.now() });
      }
    } catch (err) {
      /* storage failure: just re-render what made it in */
    }
    importingPill.hidden = true;
    plusBtn.disabled = false;
    renderVault();
  });

  // ---------- Viewer ----------
  let viewingId = null;
  let viewerUrl = null;

  function openViewer(item) {
    viewingId = item.id;
    viewerUrl = URL.createObjectURL(item.blob);
    if (item.type.startsWith('video/')) {
      viewerImg.hidden = true;
      viewerVideo.hidden = false;
      viewerVideo.src = viewerUrl;
    } else {
      viewerVideo.hidden = true;
      viewerVideo.removeAttribute('src');
      viewerImg.hidden = false;
      viewerImg.src = viewerUrl;
    }
    viewer.hidden = false;
  }

  function closeViewer() {
    if (viewer.hidden) return;
    viewer.hidden = true;
    viewerVideo.pause();
    viewerVideo.removeAttribute('src');
    viewerVideo.load();
    viewerImg.removeAttribute('src');
    if (viewerUrl) {
      URL.revokeObjectURL(viewerUrl);
      viewerUrl = null;
    }
    viewingId = null;
  }

  $('viewerClose').addEventListener('click', closeViewer);

  $('viewerDelete').addEventListener('click', async () => {
    if (viewingId === null) return;
    if (!window.confirm('Delete this item?')) return;
    const id = viewingId;
    closeViewer();
    try {
      await dbDelete(id);
    } catch (err) { /* nothing to do */ }
    renderVault();
  });

  // ---------- Vault toolbar ----------
  function closeMenu() {
    menuEl.hidden = true;
  }

  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    menuEl.hidden = !menuEl.hidden;
  });

  document.addEventListener('click', (e) => {
    if (!menuEl.hidden && !menuEl.contains(e.target)) closeMenu();
  });

  lockBtn.addEventListener('click', lockVault);

  $('menuChangeCode').addEventListener('click', () => {
    closeMenu();
    openPad('setup');
  });

  $('menuDeleteAll').addEventListener('click', async () => {
    closeMenu();
    if (!window.confirm('Delete everything in the vault?')) return;
    try {
      await dbClear();
    } catch (err) { /* nothing to do */ }
    renderVault();
  });

  // ---------- Vault open / lock ----------
  function openVault() {
    gameScreen.hidden = true;
    vaultScreen.hidden = false;
    renderVault();
  }

  function lockVault() {
    if (vaultScreen.hidden) return;
    closeViewer();
    closeMenu();
    padOverlay.hidden = true;
    revokeUrls();
    vaultScreen.hidden = true;
    gameScreen.hidden = false;
    stopGame();
  }

  // Re-lock whenever the page goes to the background.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) lockVault();
  });

  window.addEventListener('blur', () => {
    if (!suppressAutoLock) lockVault();
  });

  window.addEventListener('focus', () => {
    setTimeout(() => {
      suppressAutoLock = false;
    }, 400);
  });
})();