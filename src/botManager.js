/**
 * Bot Yöneticisi - Minecraft AFK Client
 * Bot ekleme/çıkarma, SOCKS5 proxy, RAM limiti, olay yönetimi
 */

const mineflayer = require('mineflayer');
const { SocksClient } = require('socks');
const os = require('os');

const AntiAfk = require('./antiAfk');

// ── Yardımcı Fonksiyonlar ───────────────────────────────────────

/**
 * Rastgele benzersiz ID üretir
 */
function generateId() {
  return `bot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * SOCKS5 proxy bilgisini ayrıştırır
 * Format: "ip:port" veya "host:port"
 */
function parseProxy(proxyString) {
  if (!proxyString || !proxyString.includes(':')) return null;
  const [host, portStr] = proxyString.split(':');
  const port = parseInt(portStr, 10);
  if (!host || isNaN(port)) return null;
  return { host: host.trim(), port };
}

/**
 * Mineflayer chat mesajını düz metne dönüştürür
 */
function extractChatText(message) {
  if (typeof message === 'string') return message;
  if (message && typeof message.toString === 'function') {
    return message.toString();
  }
  return JSON.stringify(message);
}

// ── Bot Yöneticisi Sınıfı ───────────────────────────────────────
class BotManager {
  /**
   * @param {Server} io - Socket.io sunucu instance
   */
  constructor(io) {
    this.io = io;
    /** @type {Map<string, Object>} - Aktif botlar */
    this.bots = new Map();
    /** @type {number} - Bot başına tahmini RAM (MB) */
    this.ramPerBot = 200;
    /** @type {number} - Minimum bot limiti */
    this.minBots = 1;
    /** @type {number|null} - Manuel override limiti */
    this.manualMaxBots = process.env.MAX_BOTS ? parseInt(process.env.MAX_BOTS, 10) : null;
  }

  // ── RAM & Limit Hesaplamaları ───────────────────────────────

  /**
   * Sistem RAM'ine göre dinamik bot limiti hesaplar
   * @returns {{ maxBots: number, usedRamMB: number, totalRamMB: number, botCount: number }}
   */
  getRamUsage() {
    const totalRamMB = Math.floor(os.totalmem() / 1024 / 1024);
    const usedRamMB = Math.floor((os.totalmem() - os.freemem()) / 1024 / 1024);
    const availableRamMB = totalRamMB - usedRamMB;

    // Manuel limit varsa onu kullan, yoksa RAM'e göre hesapla
    let maxBots;
    if (this.manualMaxBots !== null) {
      maxBots = this.manualMaxBots;
    } else {
      // Kullanılabilir RAM'in %60'ını botlara ayır
      const allocatableRam = Math.floor(availableRamMB * 0.6);
      maxBots = Math.max(this.minBots, Math.floor(allocatableRam / this.ramPerBot));
      // Güvenlik tavanı
      maxBots = Math.min(maxBots, 20);
    }

    return {
      maxBots,
      usedRamMB,
      totalRamMB,
      botCount: this.bots.size
    };
  }

  /**
   * Tüm botların özet bilgilerini döndürür (arayüz için)
   */
  getAllBots() {
    const bots = [];
    for (const [id, data] of this.bots) {
      bots.push({
        id,
        name: data.name,
        status: data.status,
        serverIp: data.serverIp,
        serverPort: data.serverPort,
        version: data.version,
        hasProxy: data.hasProxy,
        antiAfkEnabled: data.antiAfk ? data.antiAfk.isRunning : false,
        playerCount: data.players ? data.players.length : 0
      });
    }
    return bots;
  }

  // ── Bot Ekleme ──────────────────────────────────────────────

  /**
   * Yeni bir bot oluşturur ve sunucuya bağlar
   * @param {Object} config - Bot yapılandırması
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async addBot(config) {
    const { ip, port = 25565, botName, version, proxy } = config;

    // Validasyon
    if (!ip || !botName) {
      return { success: false, message: 'IP ve bot adı zorunludur.' };
    }

    // Limit kontrolü
    const ramUsage = this.getRamUsage();
    if (this.bots.size >= ramUsage.maxBots) {
      return { 
        success: false, 
        message: `Bot limitine ulaşıldı (${ramUsage.botCount}/${ramUsage.maxBots}). RAM: ${ramUsage.usedRamMB}/${ramUsage.totalRamMB} MB` 
      };
    }

    const botId = generateId();
    const serverPort = parseInt(port, 10) || 25565;
    const proxyConfig = parseProxy(proxy);

    // Bot veri yapısı
    const botData = {
      id: botId,
      name: botName,
      status: 'connecting',
      serverIp: ip,
      serverPort,
      version: version || '1.20.1',
      hasProxy: !!proxyConfig,
      proxyConfig,
      players: [],
      antiAfk: null,
      instance: null,
      connectTimeout: null
    };

    this.bots.set(botId, botData);
    this.emitBotUpdate();

    // Bağlantıyı başlat
    try {
      await this._connectBot(botData);
      return { success: true, message: `\"${botName}\" botu bağlanıyor...` };
    } catch (err) {
      this._cleanupBot(botId);
      return { success: false, message: `Bağlantı hatası: ${err.message}` };
    }
  }

  /**
   * Mineflayer botunu SOCKS5 proxy ile bağlar
   * @param {Object} botData - Bot veri yapısı
   */
  async _connectBot(botData) {
    const { serverIp, serverPort, name, version, proxyConfig } = botData;

    return new Promise((resolve, reject) => {
      let resolved = false;

      // 30 saniyelik timeout
      botData.connectTimeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error('Bağlantı zaman aşımına uğradı (30 sn).'));
        }
      }, 30000);

      const botOptions = {
        username: name,
        version: version || '1.20.1',
        // host'u kaldırıyoruz çünkü connect fonksiyonu ile manuel bağlanıyoruz
      };

      // SOCKS5 proxy varsa connect fonksiyonu ekle
      if (proxyConfig) {
        botOptions.connect = (client) => {
          SocksClient.createConnection({
            proxy: {
              host: proxyConfig.host,
              port: proxyConfig.port,
              type: 5
            },
            command: 'connect',
            destination: {
              host: serverIp,
              port: serverPort
            }
          }, (err, info) => {
            if (err) {
              if (!resolved) {
                resolved = true;
                clearTimeout(botData.connectTimeout);
                reject(new Error(`SOCKS5 proxy hatası: ${err.message}`));
              }
              return;
            }
            client.setSocket(info.socket);
            client.emit('connect');
          });
        };
        // Bazı sunucular fakeHost gerektirir
        botOptions.fakeHost = serverIp;
      } else {
        // Proxy yoksa direkt bağlan
        botOptions.host = serverIp;
        botOptions.port = serverPort;
      }

      // Bot oluştur
      const bot = mineflayer.createBot(botOptions);
      botData.instance = bot;

      // ── Olay Dinleyicileri ──────────────────────────────────

      bot.on('login', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(botData.connectTimeout);
          botData.status = 'online';
          this.emitBotUpdate();
          this.emitChatMessage(botData.id, 'system', '✅ Sunucuya giriş yapıldı.');

          // Anti-AFK başlat (varsayılan kapalı)
          botData.antiAfk = new AntiAfk(bot);

          resolve();
        }
      });

      bot.on('spawn', () => {
        this.emitChatMessage(botData.id, 'system', '🎮 Spawn noktasına ışınlandı.');
      });

      bot.on('chat', (username, message) => {
        if (username === bot.username) return; // Kendi mesajlarını atla
        this.emitChatMessage(botData.id, 'chat', `[${username}] ${message}`);
      });

      bot.on('message', (message) => {
        const text = extractChatText(message);
        // Sistem mesajlarını ve whisper'ları yakala
        if (text && text.trim()) {
          this.emitChatMessage(botData.id, 'info', text);
        }
      });

      bot.on('whisper', (username, message) => {
        this.emitChatMessage(botData.id, 'whisper', `💬 [Whisper] ${username}: ${message}`);
      });

      bot.on('playerJoined', (player) => {
        this._updatePlayerList(botData);
        this.emitChatMessage(botData.id, 'system', `➕ ${player.username} sunucuya katıldı.`);
      });

      bot.on('playerLeft', (player) => {
        this._updatePlayerList(botData);
        this.emitChatMessage(botData.id, 'system', `➖ ${player.username} sunucudan ayrıldı.`);
      });

      bot.on('kicked', (reason) => {
        const reasonText = typeof reason === 'string' ? reason : JSON.stringify(reason);
        botData.status = 'error';
        this.emitChatMessage(botData.id, 'error', `🚫 Sunucudan atıldı: ${reasonText}`);
        this.emitBotUpdate();
      });

      bot.on('error', (err) => {
        const errorMsg = err.message || 'Bilinmeyen hata';
        botData.status = 'error';
        this.emitChatMessage(botData.id, 'error', `❌ Hata: ${errorMsg}`);
        this.emitBotUpdate();

        if (!resolved) {
          resolved = true;
          clearTimeout(botData.connectTimeout);
          reject(err);
        }
      });

      bot.on('end', () => {
        if (botData.status !== 'error') {
          botData.status = 'offline';
        }
        this.emitChatMessage(botData.id, 'system', '🔌 Sunucu bağlantısı sonlandı.');
        this.emitBotUpdate();

        // Anti-AFK durdur
        if (botData.antiAfk) {
          botData.antiAfk.stop();
        }
      });
    });
  }

  // ── Oyuncu Listesi ──────────────────────────────────────────

  /**
   * Botun oyuncu listesini günceller
   */
  _updatePlayerList(botData) {
    if (!botData.instance || !botData.instance.players) return;

    botData.players = Object.values(botData.instance.players).map(p => ({
      username: p.username,
      ping: p.ping || 0,
      uuid: p.uuid
    }));
  }

  /**
   * Oyuncu listesini döndürür
   */
  getPlayerList(botId) {
    const botData = this.bots.get(botId);
    if (!botData) {
      return { success: false, message: 'Bot bulunamadı.' };
    }
    if (!botData.instance || botData.status !== 'online') {
      return { success: false, message: 'Bot çevrimdışı.' };
    }

    this._updatePlayerList(botData);
    return { success: true, players: botData.players };
  }

  // ── Mesaj Gönderme ──────────────────────────────────────────

  /**
   * Bot üzerinden sunucuya mesaj gönderir
   */
  sendMessage(botId, message) {
    const botData = this.bots.get(botId);
    if (!botData) {
      return { success: false, message: 'Bot bulunamadı.' };
    }
    if (!botData.instance || botData.status !== 'online') {
      return { success: false, message: 'Bot çevrimdışı, mesaj gönderilemez.' };
    }

    try {
      botData.instance.chat(message);
      this.emitChatMessage(botData.id, 'self', `→ ${message}`);
      return { success: true };
    } catch (err) {
      return { success: false, message: `Mesaj gönderilemedi: ${err.message}` };
    }
  }

  // ── Anti-AFK Toggle ─────────────────────────────────────────

  /**
   * Bot için Anti-AFK modunu açar/kapatır
   */
  toggleAntiAfk(botId, enabled) {
    const botData = this.bots.get(botId);
    if (!botData) {
      return { success: false, message: 'Bot bulunamadı.' };
    }
    if (!botData.antiAfk) {
      return { success: false, message: 'Anti-AFK modülü hazır değil.' };
    }
    if (botData.status !== 'online') {
      return { success: false, message: 'Bot çevrimdışı.' };
    }

    if (enabled) {
      botData.antiAfk.start();
      this.emitChatMessage(botId, 'system', '🛡️ Anti-AFK aktifleştirildi.');
    } else {
      botData.antiAfk.stop();
      this.emitChatMessage(botId, 'system', '🛡️ Anti-AFK devre dışı bırakıldı.');
    }
    this.emitBotUpdate();

    return { 
      success: true, 
      message: `Anti-AFK ${enabled ? 'açıldı' : 'kapandı'}.` 
    };
  }

  // ── Bot Çıkarma ─────────────────────────────────────────────

  /**
   * Botu sunucudan çıkarır ve kaynakları temizler
   */
  removeBot(botId) {
    const botData = this.bots.get(botId);
    if (!botData) {
      return { success: false, message: 'Bot bulunamadı.' };
    }

    this._cleanupBot(botId);
    return { success: true, message: `\"${botData.name}\" botu çıkarıldı.` };
  }

  /**
   * Bot kaynaklarını temizler
   */
  _cleanupBot(botId) {
    const botData = this.bots.get(botId);
    if (!botData) return;

    // Timeout temizle
    if (botData.connectTimeout) {
      clearTimeout(botData.connectTimeout);
    }

    // Anti-AFK durdur
    if (botData.antiAfk) {
      botData.antiAfk.stop();
    }

    // Bot bağlantısını sonlandır
    if (botData.instance) {
      try {
        botData.instance.end();
        botData.instance.removeAllListeners();
      } catch (err) {
        // Bot zaten kapalı olabilir
      }
    }

    this.bots.delete(botId);
    this.emitBotUpdate();
  }

  /**
   * Tüm botları temizler (shutdown için)
   */
  destroyAll() {
    for (const [botId] of this.bots) {
      this._cleanupBot(botId);
    }
  }

  // ── Socket.io Yayınları ─────────────────────────────────────

  /**
   * Bot listesi güncellemesini tüm istemcilere yayınlar
   */
  emitBotUpdate() {
    this.io.emit('bot-update', this.getAllBots());
  }

  /**
   * Chat mesajını tüm istemcilere yayınlar
   */
  emitChatMessage(botId, type, text) {
    const timestamp = new Date().toLocaleTimeString('tr-TR');
    this.io.emit('chat-message', { botId, type, text, timestamp });
  }
}

module.exports = BotManager;
