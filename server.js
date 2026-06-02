/**
 * Minecraft AFK Client v2.0 - Ana Sunucu
 * 
 * Yeni özellikler:
 * - Server Browser (Minecraft multiplayer tarzı sunucu listesi)
 * - Bot Kontrol Paneli (her sunucu için ayrı panel)
 * - Geri Dönüş butonu
 * - mcstatus.io API ile sunucu ikonu, MOTD, oyuncu sayısı
 * - SOCKS5 proxy desteği
 * 
 * @author Claude Opus 4.8 Style
 * @version 2.0.0
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
        // Küçük gecikme ile ekle (rate limit önlemi)
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

  // ── Bağlantı Kopması ────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`[Socket] İstemci ayrıldı: ${socket.id}`);
  });
});

// ── RAM Kullanımı Periyodik Yayını ──────────────────────────────
setInterval(() => {
  io.emit('ram-usage', botManager.getRamUsage());
}, 3000);

// ── Sunucuyu Başlat ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║   Minecraft AFK Client v2.0.0            ║`);
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
