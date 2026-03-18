const { app, BrowserWindow, screen, session } = require('electron');
const http = require('http');

let overlayWin = null;
let currentDisplayIndex = 0;  // track จอที่เลือกอยู่

// ── [เพิ่มใหม่] SERVER URL ──
// - รันบนเครื่อง dev (npm start)  → ใช้ localhost:5000 เหมือนเดิม
// - รันจาก .exe ที่ build แล้ว    → ใช้ Render URL อัตโนมัติ
// ⚠️ แก้ https://your-app.onrender.com เป็น URL จริงก่อน build ครับ
const SERVER = process.env.SERVER_URL || 'https://your-app.onrender.com';

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

  // ✅ ล้าง cache ทุกครั้งก่อนโหลด เพื่อให้ได้ไฟล์ล่าสุดเสมอ
  session.defaultSession.clearCache().then(() => {
    // ── [เปลี่ยน] localhost:5000 → SERVER (บรรทัดนี้บรรทัดเดียว) ──
    overlayWin.loadURL(`${SERVER}/overlay?lang=both`, {
      extraHeaders: 'Cache-Control: no-cache, no-store\nPragma: no-cache'
    });
  });

  overlayWin.setIgnoreMouseEvents(true, { forward: true });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.on('closed', () => { overlayWin = null; });
}

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
  return true;
}

// ── ย้าย overlay ไปตำแหน่ง x, y (relative ต่อจอที่เลือกอยู่) ── (เหมือนเดิม 100%)
function setOverlayPosition(x, y) {
  if (!overlayWin) return false;
  const displays = screen.getAllDisplays();
  const display  = displays[currentDisplayIndex] || displays[0];
  const absX = Math.round(display.bounds.x + x);
  const absY = Math.round(display.bounds.y + y);
  overlayWin.setPosition(absX, absY);
  return true;
}

// ── ดึงตำแหน่งปัจจุบัน (relative ต่อจอที่เลือกอยู่) ── (เหมือนเดิม 100%)
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

  // GET /displays
  if (req.method === 'GET' && req.url === '/displays') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getDisplays()));
    return;
  }

  // GET /position
  if (req.method === 'GET' && req.url === '/position') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getOverlayPosition()));
    return;
  }

  // POST body helper
  const readBody = (cb) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { cb(JSON.parse(body)); }
      catch(e) { res.writeHead(400); res.end(JSON.stringify({ status: 'error' })); }
    });
  };

  // POST /set-display
  if (req.method === 'POST' && req.url === '/set-display') {
    readBody(({ index }) => {
      const ok = moveOverlayToDisplay(parseInt(index));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: ok ? 'ok' : 'error', index }));
    });
    return;
  }

  // POST /set-position
  if (req.method === 'POST' && req.url === '/set-position') {
    readBody(({ x, y }) => {
      const ok = setOverlayPosition(Number(x), Number(y));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: ok ? 'ok' : 'error', ...getOverlayPosition() }));
    });
    return;
  }

  // POST /set-draggable (รับ request แต่ drag จัดการใน overlay.html ผ่าน SSE)
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
