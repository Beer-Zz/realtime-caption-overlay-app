const { app, BrowserWindow, screen, session } = require('electron');
const http = require('http');

let overlayWin = null;
let currentDisplayIndex = 0;

// ── [เพิ่มใหม่] SERVER URL ──
// - npm start (dev)  → localhost:5000
// - .exe (cloud)     → Render URL
const SERVER = process.env.SERVER_URL || 'https://event-box.onrender.com';

// ── ดึงรายการจอทั้งหมด ── (เหมือนเดิม 100%)
function getDisplays() {
  const primary = screen.getPrimaryDisplay();
  return screen.getAllDisplays().map((d, i) => {
    const scale = d.scaleFactor || 1;
    const physW = Math.round(d.size.width  * scale);
    const physH = Math.round(d.size.height * scale);
    return {
      index:     i,
      id:        d.id,
      label:     `จอที่ ${i + 1}  (${physW}×${physH})${d.id === primary.id ? '  ★ Primary' : ''}`,
      x:         d.bounds.x,
      y:         d.bounds.y,
      width:     d.size.width,
      height:    d.size.height,
      isPrimary: d.id === primary.id,
      scaleFactor: scale,
    };
  });
}

// ── [เพิ่มใหม่] ส่งข้อมูลไปบอก Flask ──
function notifyFlask(path, data) {
  try {
    const url = new URL(SERVER);
    const isHttps = url.protocol === 'https:';
    const mod = isHttps ? require('https') : require('http');
    const body = JSON.stringify(data);
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: path,
      method: 'POST',
      rejectUnauthorized: false,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = mod.request(options);
    req.on('error', () => {});
    req.write(body);
    req.end();
  } catch(e) {}
}

// ── [เพิ่มใหม่] ส่งข้อมูลจอทั้งหมดไปให้ Flask ──
function registerToFlask() {
  const displays = getDisplays();
  const pos = getOverlayPosition();
  notifyFlask('/electron-register', {
    displays,
    currentDisplayIndex,
    position: pos,
  });
}

// ── สร้าง overlay window (โครงเดิม 100%) ──
function createOverlay() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  overlayWin = new BrowserWindow({
    width, height, x: 0, y: 0,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // ✅ ล้าง cache ทุกครั้งก่อนโหลด
  session.defaultSession.clearCache().then(() => {
    overlayWin.loadURL(`${SERVER}/overlay?lang=both`, {
      extraHeaders: 'Cache-Control: no-cache, no-store\nPragma: no-cache'
    });
  });

  overlayWin.setIgnoreMouseEvents(true, { forward: true });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.on('closed', () => { overlayWin = null; });

  // ── [เพิ่มใหม่] แจ้ง Flask ว่า Electron พร้อมแล้ว ──
  setTimeout(() => registerToFlask(), 2000);
  setTimeout(() => registerToFlask(), 5000);
  setTimeout(() => registerToFlask(), 10000);

  // ── [เพิ่มใหม่] polling ตำแหน่งจาก Flask ทุก 500ms ──
  let lastX = -1;
  let lastY = -1;

  function pollPosition() {
    try {
      const url = new URL(SERVER);
      const isHttps = url.protocol === 'https:';
      const mod = isHttps ? require('https') : require('http');
      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: '/position',
        method: 'GET',
        rejectUnauthorized: false,
      };
      const req = mod.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.x !== undefined && data.y !== undefined) {
              // ย้ายเฉพาะเมื่อตำแหน่งเปลี่ยนแปลง
              if (data.x !== lastX || data.y !== lastY) {
                lastX = data.x;
                lastY = data.y;
                setOverlayPosition(data.x, data.y);
              }
            }
          } catch(e) {}
          setTimeout(pollPosition, 500);
        });
      });
      req.on('error', () => setTimeout(pollPosition, 500));
      req.end();
    } catch(e) { setTimeout(pollPosition, 500); }
  }
  setTimeout(pollPosition, 3000);

  // ── polling display index จาก Flask ──
  let lastDisplayIndex = -1;

  function pollDisplay() {
    try {
      const url = new URL(SERVER);
      const isHttps = url.protocol === 'https:';
      const mod = isHttps ? require('https') : require('http');
      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: '/electron-state',
        method: 'GET',
        rejectUnauthorized: false,
      };
      const req = mod.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.currentDisplayIndex !== undefined &&
                data.currentDisplayIndex !== lastDisplayIndex) {
              lastDisplayIndex = data.currentDisplayIndex;
              _suppressRegister = true;
              moveOverlayToDisplay(data.currentDisplayIndex);
              _suppressRegister = false;
            }
          } catch(e) {}
          setTimeout(pollDisplay, 800);
        });
      });
      req.on('error', () => setTimeout(pollDisplay, 800));
      req.end();
    } catch(e) { setTimeout(pollDisplay, 800); }
  }
  setTimeout(pollDisplay, 3000);
}

// ── ป้องกัน register loop เมื่อ pollDisplay สั่งย้ายจอ ──
let _suppressRegister = false;

// ── ย้าย overlay ไปจอที่ index ── (เหมือนเดิม 100%)
function moveOverlayToDisplay(index) {
  const displays = screen.getAllDisplays();
  if (index < 0 || index >= displays.length) return false;
  const { x, y, width, height } = displays[index].bounds;
  if (overlayWin) {
    overlayWin.setBounds({ x, y, width, height });
    overlayWin.setAlwaysOnTop(true, 'screen-saver');
  }
  currentDisplayIndex = index;
  // ── [เพิ่มใหม่] อัปเดต Flask (ยกเว้นตอนถูกสั่งจาก pollDisplay) ──
  if (!_suppressRegister) registerToFlask();
  return true;
}

// ── ย้าย overlay ไปตำแหน่ง x, y ── (เหมือนเดิม 100%)
function setOverlayPosition(x, y) {
  if (!overlayWin) return false;
  const displays = screen.getAllDisplays();
  const display  = displays[currentDisplayIndex] || displays[0];
  const absX = Math.round(display.bounds.x + x);
  const absY = Math.round(display.bounds.y + y);
  overlayWin.setPosition(absX, absY);
  // ── [เพิ่มใหม่] อัปเดต Flask ──
  registerToFlask();
  return true;
}

// ── ดึงตำแหน่งปัจจุบัน ── (เหมือนเดิม 100%)
function getOverlayPosition() {
  if (!overlayWin) return { x: 0, y: 0, width: 1920, height: 1080 };
  const [absX, absY] = overlayWin.getPosition();
  const [w, h]       = overlayWin.getSize();
  const displays     = screen.getAllDisplays();
  const display      = displays[currentDisplayIndex] || displays[0];
  return {
    x:      absX - display.bounds.x,
    y:      absY - display.bounds.y,
    width:  w,
    height: h,
  };
}

// ══════════════════════════════════════════════════════════
// Internal HTTP server (port 5001) — สำหรับ Flask เรียกกลับ
// (เหมือนเดิม 100%)
// ══════════════════════════════════════════════════════════
const INTERNAL_PORT = 5001;

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && req.url === '/displays') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getDisplays()));
    return;
  }

  if (req.method === 'GET' && req.url === '/position') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getOverlayPosition()));
    return;
  }

  const readBody = (cb) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { cb(JSON.parse(body)); }
      catch(e) { res.writeHead(400); res.end(JSON.stringify({ status: 'error' })); }
    });
  };

  if (req.method === 'POST' && req.url === '/set-display') {
    readBody(({ index }) => {
      const ok = moveOverlayToDisplay(parseInt(index));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: ok ? 'ok' : 'error', index }));
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/set-position') {
    readBody(({ x, y }) => {
      const ok = setOverlayPosition(Number(x), Number(y));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: ok ? 'ok' : 'error', ...getOverlayPosition() }));
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/set-draggable') {
    readBody(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    });
    return;
  }

  res.writeHead(404); res.end('Not found');

}).listen(INTERNAL_PORT, '127.0.0.1', () => {
  console.log(`✅ Electron internal server: http://127.0.0.1:${INTERNAL_PORT}`);
});

// ── App lifecycle (โครงเดิม 100%) ──
app.whenReady().then(() => {
  createOverlay();
  app.on('activate', () => { if (!overlayWin) createOverlay(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
