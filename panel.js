/* panel.js - 四模块总控制面板: 连接 broker.emqx.io, 订阅遥测并更新各卡片 */
const BROKERS = {
  "EMQX 公共 wss": "wss://broker.emqx.io:8084/mqtt",
  "HiveMQ 公共 wss": "wss://broker.hivemq.com:8884/mqtt",
};
const DB_NAME = "mqtt_cache";      // 复用原看板缓存库
const STORE = "messages";
const MAX_ROWS = 300;

const $ = (id) => document.getElementById(id);
const brokerSel = $("broker"), topicInput = $("topic");
const connectBtn = $("connect"), disconnectBtn = $("disconnect");
const statusEl = $("status"), mstatEl = $("mstat"), rowsEl = $("rows");

let client = null, connected = false;
let count = 0, lastSeq = -1, gaps = 0;
let rateWin = [], rowBuf = [], writeBuf = [];

for (const n in BROKERS) {
  const o = document.createElement("option");
  o.value = BROKERS[n]; o.textContent = n;
  brokerSel.appendChild(o);
}
(function loadCfg() {
  const q = new URLSearchParams(location.search);
  const saved = JSON.parse(localStorage.getItem("mqttcfg") || "{}");
  const b = q.get("broker") || saved.broker || brokerSel.value;
  if ([...brokerSel.options].some(o => o.value === b)) brokerSel.value = b;
  topicInput.value = q.get("topic") || saved.topic || topicInput.value;
})();

function setStatus(t, cls) { statusEl.textContent = t; statusEl.className = "pill " + (cls || ""); }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c])); }

/* ---- IndexedDB 落盘(与原看板共用) ---- */
let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((res, rej) => {
    const rq = indexedDB.open(DB_NAME, 1);
    rq.onupgradeneeded = () => {
      const st = rq.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      st.createIndex("ts", "ts");
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
  return dbPromise;
}
function flushWrites() {
  if (!writeBuf.length) return;
  const b = writeBuf; writeBuf = [];
  openDB().then(db => {
    const tx = db.transaction(STORE, "readwrite");
    const st = tx.objectStore(STORE);
    for (const r of b) st.add(r);
  }).catch(() => {});
}

/* ---- 连接 ---- */
function connect() {
  const url = brokerSel.value, topic = topicInput.value.trim();
  localStorage.setItem("mqttcfg", JSON.stringify({ broker: url, topic }));
  setStatus("连接中…", "");
  client = mqtt.connect(url, { clientId: "panel-" + Math.random().toString(16).slice(2, 10), clean: true });
  client.on("connect", () => {
    connected = true;
    setStatus("已连接", "on");
    connectBtn.disabled = true; disconnectBtn.disabled = false;
    client.subscribe(topic, { qos: 0 });
  });
  client.on("message", (t, payload) => onMessage(t, payload));
  client.on("error", (e) => setStatus("错误: " + e.message, "off"));
  client.on("close", () => { connected = false; setStatus("已断开", "off"); connectBtn.disabled = false; disconnectBtn.disabled = true; });
}
function disconnect() { if (client) client.end(true); }

/* ---- 收到消息 ---- */
function onMessage(topic, bytes) {
  const now = Date.now();
  const text = new TextDecoder().decode(bytes);
  count++;
  rateWin.push(now);
  writeBuf.push({ ts: now, topic, size: bytes.length, payload: text });
  rowBuf.push({ ts: now, size: bytes.length, payload: text });
  if (rowBuf.length > MAX_ROWS) rowBuf = rowBuf.slice(-MAX_ROWS);

  // 解析遥测 JSON → 更新卡片
  let d = null;
  try { d = JSON.parse(text); } catch (e) { return; }
  if (d && typeof d.seq === "number") {
    if (lastSeq >= 0 && d.seq !== lastSeq + 1) gaps += Math.max(0, d.seq - lastSeq - 1);
    lastSeq = d.seq;
    updateModule(d);
    mstatEl.textContent = "遥测 seq " + d.seq;
    mstatEl.className = "pill on";
  }
  schedule();
}

function setDot(id, cls) { const e = $(id); if (e) e.className = "dot " + (cls || ""); }

function updateModule(d) {
  // ② 4G
  $("v-pub").textContent = d.seq ?? "--";
  setDot("d-4g", "on");
  // ① WS63
  if (d.ws63_tx != null) {
    $("v-ws63-tx").textContent = fmtB(d.ws63_tx);
    $("v-ws63-pkt").textContent = Math.round(d.ws63_tx / 208);
    setDot("d-ws63", "on");
  }
  // ③ EXD35
  if (d.rid_frames != null) {
    $("v-rid-f").textContent = d.rid_frames;
    $("v-rid-tx").textContent = fmtB(d.rid_tx);
    setDot("d-exd", "on");
  }
  // ④ VS36
  if (d.adsb != null) {
    $("v-adsb").textContent = d.adsb;
    $("v-adsb-rx").textContent = d.adsb > 0 ? "有数据" : "0B(无飞机)";
    setDot("d-adsb", d.adsb > 0 ? "on" : "idle");
  }
  // 汇总
  $("v-seq").textContent = (d.seq ?? "--") + " / " + (d.uptime ?? "--") + "s";
  $("v-avoid").textContent = d.avoid ?? "--";
  $("v-threats").textContent = d.threats ?? "--";
  $("v-last").textContent = new Date().toLocaleTimeString();
}

function fmtB(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  return (n / 1048576).toFixed(2) + " MB";
}

let timer = null;
function schedule() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    flushWrites();
    renderRows();
    renderStats();
  }, 250);
}
function renderRows() {
  if (!rowBuf.length) return;
  const html = rowBuf.slice(-MAX_ROWS).reverse().map(r =>
    `<tr><td>${new Date(r.ts).toLocaleTimeString()}</td><td>p4max</td><td>${r.size}</td>` +
    `<td class="p" title="${esc(r.payload)}">${esc(r.payload)}</td></tr>`).join("");
  rowsEl.innerHTML = html;
}
function renderStats() {
  const now = Date.now();
  rateWin = rateWin.filter(t => now - t < 10000);
  $("v-count").textContent = count;
  $("v-rate").textContent = (rateWin.length / 10).toFixed(2);
  $("v-gap").textContent = gaps;
}

connectBtn.onclick = connect;
disconnectBtn.onclick = disconnect;
window.addEventListener("beforeunload", () => { if (client) client.end(true); });
