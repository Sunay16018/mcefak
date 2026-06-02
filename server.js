/**
 * Minecraft AFK Client - Ana Sunucu
 * Node.js + Express + Socket.io + Mineflayer + SOCKS5 Proxy
 * 
 * @author Claude Opus 4.8 Style
 * @version 1.0.0
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
        socket.emit('system-message', { 
          type: 'error', 
          text: result.message 
        });
        return;
      }
      socket.emit('system-message', { 
        type: 'success', 
        text: result.message 
      });
    } catch (err) {
      console.error('[Socket] add-bot hatası:', err);
      socket.emit('system-message', { 
        type: 'error', 
        text: 'Bot eklenirken beklenmeyen hata oluştu.' 
      });
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
      socket.emit('system-message', { 
        type: 'error', 
        text: 'Bot çıkarılırken hata oluştu.' 
      });
    }
  });

  // ── Mesaj Gönder ────────────────────────────────────────────
  socket.on('send-message', ({ botId, message }) => {
    try {
      const result = botManager.sendMessage(botId, message);
      if (!result.success) {
        socket.emit('system-message', { 
          type: 'error', 
          text: result.message 
        });
      }
    } catch (err) {
      console.error('[Socket] send-message hatası:', err);
      socket.emit('system-message', { 
        type: 'error', 
        text: 'Mesaj gönderilemedi.' 
      });
    }
  });

  // ── Oyuncu Listesi İste ─────────────────────────────────────
  socket.on('request-player-list', (botId) => {
    try {
      const result = botManager.getPlayerList(botId);
      if (result.success) {
        socket.emit('player-list', { botId, players: result.players });
      } else {
        socket.emit('system-message', { 
          type: 'error', 
          text: result.message 
        });
      }
    } catch (err) {
      console.error('[Socket] request-player-list hatası:', err);
      socket.emit('system-message', { 
        type: 'error', 
        text: 'Oyuncu listesi alınamadı.' 
      });
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
      socket.emit('system-message', { 
        type: 'error', 
        text: 'Anti-AFK ayarı değiştirilemedi.' 
      });
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
  console.log(`║   Minecraft AFK Client v1.0.0            ║`);
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
