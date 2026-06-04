/**
 * Minecraft AFK Client v3.0 - Ana Sunucu
 * 
 * Yeni özellikler:
 * - Bot koordinat, can, açlık takibi
 * - WASD hareket kontrolü (jump, sneak, sit)
 * - Bot başına özel script çalıştırma paneli
 * - Server Browser + Bot Kontrol Paneli
 * - mcstatus.io API ile sunucu ikonu, MOTD, oyuncu sayısı
 * - SOCKS5 proxy desteği
 * - Dinamik RAM limiti
 * 
 * @version 3.0.0
 */

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
require('dotenv').config();

const BotManager = require('./src/botManager');

// ── Express & HTTP Sunucu Kurulumu ──────────────────────────────
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling']
});

// Statik dosyalar
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Ana sayfa
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Bot Yöneticisi ──────────────────────────────────────────────
const botManager = new BotManager(io);

// ── Socket.io Olayları ──────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[Socket] İstemci bağlandı: ${socket.id}`);

  // Mevcut botları ve RAM kullanımını gönder
  socket.emit('ram-usage', botManager.getRamUsage());
  socket.emit('bot-update', botManager.getAllBots());

  // ── Bot Ekle ────────────────────────────────────────────────
  socket.on('add-bot', async (data) => {
    try {
      const result = await botManager.addBot(data);
      if (!result.success) {
        socket.emit('system-message', { type: 'error', text: result.message });
        return;
      }
      socket.emit('system-message', { type: 'success', text: result.message });
    } catch (err) {
      console.error('[Socket] add-bot hatası:', err);
      socket.emit('system-message', { type: 'error', text: 'Bot eklenirken beklenmeyen hata oluştu.' });
    }
  });

  // ── Toplu Bot Ekle (Server Browser'dan) ───────────────────
  socket.on('add-bots-batch', async (data) => {
    try {
      const { serverIp, port, version, proxy, botNames } = data;
      const results = [];

      for (const botName of botNames) {
        const result = await botManager.addBot({
          ip: serverIp,
          port,
          botName,
          version,
          proxy
        });
        results.push(result);
        await new Promise(r => setTimeout(r, 500));
      }

      const successCount = results.filter(r => r.success).length;
      socket.emit('system-message', { 
        type: 'success', 
        text: `${successCount}/${botNames.length} bot eklendi.` 
      });
    } catch (err) {
      console.error('[Socket] add-bots-batch hatası:', err);
      socket.emit('system-message', { type: 'error', text: 'Toplu ekleme hatası.' });
    }
  });

  // ── Bot Çıkar ───────────────────────────────────────────────
  socket.on('remove-bot', (botId) => {
    try {
      const result = botManager.removeBot(botId);
      socket.emit('system-message', { 
        type: result.success ? 'success' : 'error', 
        text: result.message 
      });
    } catch (err) {
      console.error('[Socket] remove-bot hatası:', err);
      socket.emit('system-message', { type: 'error', text: 'Bot çıkarılırken hata oluştu.' });
    }
  });

  // ── Sunucudaki Tüm Botları Çıkar ────────────────────────────
  socket.on('remove-server-bots', (serverKey) => {
    try {
      const result = botManager.removeServerBots(serverKey);
      socket.emit('system-message', { 
        type: result.success ? 'success' : 'error', 
        text: result.message 
      });
    } catch (err) {
      console.error('[Socket] remove-server-bots hatası:', err);
      socket.emit('system-message', { type: 'error', text: 'Sunucu botları çıkarılırken hata.' });
    }
  });

  // ── Mesaj Gönder ────────────────────────────────────────────
  socket.on('send-message', ({ botId, message }) => {
    try {
      const result = botManager.sendMessage(botId, message);
      if (!result.success) {
        socket.emit('system-message', { type: 'error', text: result.message });
      }
    } catch (err) {
      console.error('[Socket] send-message hatası:', err);
      socket.emit('system-message', { type: 'error', text: 'Mesaj gönderilemedi.' });
    }
  });

  // ── Oyuncu Listesi İste ─────────────────────────────────────
  socket.on('request-player-list', (botId) => {
    try {
      const result = botManager.getPlayerList(botId);
      if (result.success) {
        socket.emit('player-list', { botId, players: result.players });
      } else {
        socket.emit('system-message', { type: 'error', text: result.message });
      }
    } catch (err) {
      console.error('[Socket] request-player-list hatası:', err);
      socket.emit('system-message', { type: 'error', text: 'Oyuncu listesi alınamadı.' });
    }
  });

  // ── Anti-AFK Toggle ─────────────────────────────────────────
  socket.on('toggle-antiafk', ({ botId, enabled }) => {
    try {
      const result = botManager.toggleAntiAfk(botId, enabled);
      socket.emit('system-message', { 
        type: result.success ? 'success' : 'error', 
        text: result.message 
      });
    } catch (err) {
      console.error('[Socket] toggle-antiafk hatası:', err);
      socket.emit('system-message', { type: 'error', text: 'Anti-AFK ayarı değiştirilemedi.' });
    }
  });

  // ── Tüm Botlarda Anti-AFK Toggle ──────────────────────────
  socket.on('toggle-all-antiafk', ({ serverKey, enabled }) => {
    try {
      const result = botManager.toggleAllAntiAfk(serverKey, enabled);
      socket.emit('system-message', { 
        type: result.success ? 'success' : 'error', 
        text: result.message 
      });
    } catch (err) {
      console.error('[Socket] toggle-all-antiafk hatası:', err);
      socket.emit('system-message', { type: 'error', text: 'Toplu Anti-AFK hatası.' });
    }
  });

  // ── Tüm Botlara Mesaj Gönder ──────────────────────────────
  socket.on('broadcast-message', ({ serverKey, message }) => {
    try {
      const result = botManager.broadcastMessage(serverKey, message);
      socket.emit('system-message', { 
        type: result.success ? 'success' : 'error', 
        text: result.message 
      });
    } catch (err) {
      console.error('[Socket] broadcast-message hatası:', err);
      socket.emit('system-message', { type: 'error', text: 'Toplu mesaj hatası.' });
    }
  });

  // ── Bot Hareket Kontrolü ──────────────────────────────────
  socket.on('bot-move', ({ botId, action, state: moveState }) => {
    try {
      const result = botManager.handleBotMove(botId, action, moveState);
      if (!result.success) {
        socket.emit('system-message', { type: 'error', text: result.message });
      }
    } catch (err) {
      console.error('[Socket] bot-move hatası:', err);
      socket.emit('system-message', { type: 'error', text: 'Hareket komutu hatası.' });
    }
  });

  // ── Bot Script Çalıştır ───────────────────────────────────
  socket.on('run-bot-script', ({ botId, script }) => {
    try {
      const result = botManager.runBotScript(botId, script);
      socket.emit('system-message', { 
        type: result.success ? 'success' : 'error', 
        text: result.message 
      });
      if (result.output) {
        socket.emit('chat-message', { 
          botId, 
          type: 'system', 
          text: `[Script Output] ${result.output}`, 
          timestamp: new Date().toLocaleTimeString('tr-TR') 
        });
      }
    } catch (err) {
      console.error('[Socket] run-bot-script hatası:', err);
      socket.emit('system-message', { type: 'error', text: 'Script çalıştırma hatası.' });
    }
  });

  // ── Bot Script Durdur ─────────────────────────────────────
  socket.on('stop-bot-script', (botId) => {
    try {
      const result = botManager.stopBotScript(botId);
      socket.emit('system-message', { 
        type: result.success ? 'success' : 'error', 
        text: result.message 
      });
    } catch (err) {
      console.error('[Socket] stop-bot-script hatası:', err);
      socket.emit('system-message', { type: 'error', text: 'Script durdurma hatası.' });
    }
  });

  // ── Bot Script Durumu Sorgula ─────────────────────────────
  socket.on('get-script-status', (botId) => {
    try {
      const result = botManager.getScriptStatus(botId);
      socket.emit('script-status', { botId, ...result });
    } catch (err) {
      console.error('[Socket] get-script-status hatası:', err);
    }
  });

  // ── Bağlantı Kopması ────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`[Socket] İstemci ayrıldı: ${socket.id}`);
  });
});

// ── RAM Kullanımı & Bot Durumu Periyodik Yayını ────────────────
setInterval(() => {
  io.emit('ram-usage', botManager.getRamUsage());
}, 3000);

// Bot durumlarını periyodik güncelle (koordinat, can, açlık)
setInterval(() => {
  const botData = botManager.getAllBotsWithStats();
  io.emit('bot-stats-update', botData);
}, 500);

// ── Sunucuyu Başlat ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║   Minecraft AFK Client v3.1.0            ║`);
  console.log(`║   Port: ${PORT.toString().padEnd(33)}║`);
  console.log(`║   Mode: ${(process.env.PORT ? 'Render.com' : 'Local').padEnd(33)}║`);
  console.log(`╚══════════════════════════════════════════╝\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n[SIGTERM] Sunucu kapatılıyor...');
  botManager.destroyAll();
  httpServer.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('\n[SIGINT] Sunucu kapatılıyor...');
  botManager.destroyAll();
  httpServer.close(() => process.exit(0));
});
