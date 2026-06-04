/**
 * Bot Yöneticisi v3.0 - Minecraft AFK Client
 * 
 * Yeni özellikler:
 * - Bot koordinat, can, açlık, XP takibi
 * - WASD hareket kontrolü (forward, back, left, right, jump, sneak, sit)
 * - Bot başına özel script çalıştırma (sandboxed VM)
 * - Sunucu bazlı bot gruplama
 * - Toplu bot ekleme/çıkarma
 * - Toplu Anti-AFK toggle
 * - Toplu mesaj gönderme
 * - SOCKS5 proxy desteği
 * - Dinamik RAM limiti
 */

const mineflayer = require('mineflayer');
const { SocksClient } = require('socks');
const os = require('os');
const vm = require('vm');
const { EventEmitter } = require('events');

const AntiAfk = require('./antiAfk');

// ── Yardımcı Fonksiyonlar ───────────────────────────────────────

function generateId() {
  return `bot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function parseProxy(proxyString) {
  if (!proxyString || !proxyString.includes(':')) return null;
  const [host, portStr] = proxyString.split(':');
  const port = parseInt(portStr, 10);
  if (!host || isNaN(port)) return null;
  return { host: host.trim(), port };
}

function extractChatText(message) {
  if (typeof message === 'string') return message;
  if (message && typeof message.toString === 'function') {
    try {
      const str = message.toString();
      if (str && str !== '[object Object]') return str;
    } catch (e) {}
  }
  if (message && message.json) {
    try {
      return JSON.stringify(message.json);
    } catch (e) {}
  }
  if (message && message.text) {
    return message.text;
  }
  try {
    return JSON.stringify(message);
  } catch (e) {
    return String(message);
  }
}

function getServerKey(ip, port) {
  return `${ip}:${port}`;
}

// ── Script Runner Sınıfı (Durdurulabilir Script) ────────────────
class ScriptRunner extends EventEmitter {
  constructor(botManager, botId, bot) {
    super();
    this.botManager = botManager;
    this.botId = botId;
    this.bot = bot;
    this.isRunning = false;
    this.context = null;
    this.timeouts = new Set();
    this.intervals = new Set();
    this.startTime = null;
  }

  _createSandbox() {
    const self = this;

    const wrappedSetTimeout = (fn, delay, ...args) => {
      if (!self.isRunning) return;
      const id = setTimeout((...a) => {
        self.timeouts.delete(id);
        if (self.isRunning) fn(...a);
      }, delay, ...args);
      self.timeouts.add(id);
      return id;
    };

    const wrappedSetInterval = (fn, delay, ...args) => {
      if (!self.isRunning) return;
      const id = setInterval((...a) => {
        if (!self.isRunning) {
          clearInterval(id);
          self.intervals.delete(id);
          return;
        }
        fn(...a);
      }, delay, ...args);
      self.intervals.add(id);
      return id;
    };

    const wrappedClearTimeout = (id) => {
      self.timeouts.delete(id);
      clearTimeout(id);
    };

    const wrappedClearInterval = (id) => {
      self.intervals.delete(id);
      clearInterval(id);
    };

    return {
      bot: this.bot,
      console: {
        log: (...args) => {
          if (!self.isRunning) return;
          const text = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
          self.botManager.emitChatMessage(self.botId, 'system', `[Script] ${text}`);
        },
        error: (...args) => {
          if (!self.isRunning) return;
          const text = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
          self.botManager.emitChatMessage(self.botId, 'error', `[Script Error] ${text}`);
        },
        warn: (...args) => {
          if (!self.isRunning) return;
          const text = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
          self.botManager.emitChatMessage(self.botId, 'info', `[Script Warn] ${text}`);
        }
      },
      setTimeout: wrappedSetTimeout,
      setInterval: wrappedSetInterval,
      clearTimeout: wrappedClearTimeout,
      clearInterval: wrappedClearInterval,
      Math,
      Date,
      JSON,
      String,
      Number,
      Array,
      Object,
      Promise,
      Buffer,
      require: (mod) => {
        const allowed = ['vec3'];
        if (allowed.includes(mod)) return require(mod);
        throw new Error(`Modül '${mod}' izin verilmiyor.`);
      }
    };
  }

  run(scriptCode) {
    if (this.isRunning) {
      return { success: false, message: 'Zaten çalışan bir script var. Önce durdurun.' };
    }

    try {
      this.isRunning = true;
      this.startTime = Date.now();
      const sandbox = this._createSandbox();
      this.context = vm.createContext(sandbox);

      const script = new vm.Script(scriptCode);
      const result = script.runInContext(this.context, {
        timeout: 10000,
        displayErrors: true
      });

      this.botManager.emitChatMessage(this.botId, 'system', '▶️ Script başlatıldı. Interval/timeout aktif.');

      return { 
        success: true, 
        message: 'Script çalıştırıldı. Durdurmak için Durdur butonuna basın.',
        output: result !== undefined ? String(result) : ''
      };
    } catch (err) {
      this.stop();
      return { success: false, message: `Script hatası: ${err.message}` };
    }
  }

  stop() {
    if (!this.isRunning) {
      return { success: false, message: 'Çalışan script yok.' };
    }

    this.isRunning = false;

    for (const id of this.timeouts) {
      clearTimeout(id);
    }
    this.timeouts.clear();

    for (const id of this.intervals) {
      clearInterval(id);
    }
    this.intervals.clear();

    const duration = this.startTime ? ((Date.now() - this.startTime) / 1000).toFixed(1) : '0';
    this.botManager.emitChatMessage(this.botId, 'system', `⏹️ Script durduruldu. Süre: ${duration}s`);

    return { success: true, message: `Script durduruldu. (${duration} saniye çalıştı)` };
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      startTime: this.startTime,
      activeTimeouts: this.timeouts.size,
      activeIntervals: this.intervals.size
    };
  }
}

// ── Bot Yöneticisi Sınıfı ───────────────────────────────────────
class BotManager {
  constructor(io) {
    this.io = io;
    /** @type {Map<string, Object>} - Aktif botlar (id -> botData) */
    this.bots = new Map();
    /** @type {Map<string, ScriptRunner>} - Aktif script runner'lar */
    this.scriptRunners = new Map();
    /** @type {number} - Bot başına tahmini RAM (MB) */
    this.ramPerBot = 200;
    /** @type {number} - Minimum bot limiti */
    this.minBots = 1;
    /** @type {number|null} - Manuel override limiti */
    this.manualMaxBots = process.env.MAX_BOTS ? parseInt(process.env.MAX_BOTS, 10) : null;
  }

  // ── RAM & Limit Hesaplamaları ───────────────────────────────

  getRamUsage() {
    const totalRamMB = Math.floor(os.totalmem() / 1024 / 1024);
    const usedRamMB = Math.floor((os.totalmem() - os.freemem()) / 1024 / 1024);
    const availableRamMB = totalRamMB - usedRamMB;

    let maxBots;
    if (this.manualMaxBots !== null) {
      maxBots = this.manualMaxBots;
    } else {
      const allocatableRam = Math.floor(availableRamMB * 0.6);
      maxBots = Math.max(this.minBots, Math.floor(allocatableRam / this.ramPerBot));
      maxBots = Math.min(maxBots, 20);
    }

    return { maxBots, usedRamMB, totalRamMB, botCount: this.bots.size };
  }

  // ── Bot Verisi Dönüştürücü (Arayüz için) ──────────────────

  getAllBots() {
    const bots = [];
    for (const [id, data] of this.bots) {
      bots.push({
        id,
        name: data.name,
        status: data.status,
        serverIp: data.serverIp,
        serverPort: data.serverPort,
        serverKey: data.serverKey,
        version: data.version,
        hasProxy: data.hasProxy,
        antiAfkEnabled: data.antiAfk ? data.antiAfk.isRunning : false,
        scriptRunning: this.scriptRunners.get(id)?.getStatus()?.isRunning || false,
        playerCount: data.players ? data.players.length : 0
      });
    }
    return bots;
  }

  /**
   * Bot istatistiklerini döndürür (koordinat, can, açlık, XP)
   */
  getAllBotsWithStats() {
    const bots = [];
    for (const [id, data] of this.bots) {
      const stats = this._getBotStats(data);
      bots.push({
        id,
        name: data.name,
        status: data.status,
        serverIp: data.serverIp,
        serverPort: data.serverPort,
        serverKey: data.serverKey,
        version: data.version,
        hasProxy: data.hasProxy,
        antiAfkEnabled: data.antiAfk ? data.antiAfk.isRunning : false,
        scriptRunning: this.scriptRunners.get(id)?.getStatus()?.isRunning || false,
        playerCount: data.players ? data.players.length : 0,
        ...stats
      });
    }
    return bots;
  }

  _getBotStats(botData) {
    const bot = botData.instance;
    if (!bot || !bot.entity || botData.status !== 'online') {
      return {
        x: null, y: null, z: null,
        health: null, maxHealth: null,
        food: null, foodSaturation: null,
        xp: null, level: null
      };
    }

    return {
      x: Math.round(bot.entity.position.x * 10) / 10,
      y: Math.round(bot.entity.position.y * 10) / 10,
      z: Math.round(bot.entity.position.z * 10) / 10,
      health: Math.round(bot.health * 10) / 10,
      maxHealth: bot.maxHealth || 20,
      food: bot.food || 0,
      foodSaturation: Math.round((bot.foodSaturation || 0) * 10) / 10,
      xp: Math.round((bot.experience ? bot.experience.points : 0)),
      level: bot.experience ? bot.experience.level : 0
    };
  }

  /**
   * Sunucu bazlı gruplanmış botları döndürür
   */
  getBotsByServer() {
    const servers = new Map();

    for (const [id, data] of this.bots) {
      const key = data.serverKey;
      if (!servers.has(key)) {
        servers.set(key, {
          serverKey: key,
          serverIp: data.serverIp,
          serverPort: data.serverPort,
          version: data.version,
          hasProxy: data.hasProxy,
          proxyConfig: data.proxyConfig,
          bots: []
        });
      }
      servers.get(key).bots.push({
        id,
        name: data.name,
        status: data.status,
        antiAfkEnabled: data.antiAfk ? data.antiAfk.isRunning : false,
        scriptRunning: this.scriptRunners.get(id)?.getStatus()?.isRunning || false,
        playerCount: data.players ? data.players.length : 0
      });
    }

    return Array.from(servers.values());
  }

  // ── Bot Ekleme ──────────────────────────────────────────────

  async addBot(config) {
    const { ip, port = 25565, botName, version, proxy } = config;

    if (!ip || !botName) {
      return { success: false, message: 'IP ve bot adı zorunludur.' };
    }

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
    const serverKey = getServerKey(ip, serverPort);

    const botData = {
      id: botId,
      name: botName,
      status: 'connecting',
      serverIp: ip,
      serverPort,
      serverKey,
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

    try {
      await this._connectBot(botData);
      return { success: true, message: `"${botName}" botu bağlanıyor...` };
    } catch (err) {
      this._cleanupBot(botId);
      return { success: false, message: `Bağlantı hatası: ${err.message}` };
    }
  }

  // ── SOCKS5 Proxy ile Bağlantı ───────────────────────────────

  async _connectBot(botData) {
    const { serverIp, serverPort, name, version, proxyConfig } = botData;

    return new Promise((resolve, reject) => {
      let resolved = false;

      botData.connectTimeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error('Bağlantı zaman aşımına uğradı (30 sn).'));
        }
      }, 30000);

      const botOptions = {
        username: name,
        version: version || '1.20.1',
      };

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
        botOptions.fakeHost = serverIp;
      } else {
        botOptions.host = serverIp;
        botOptions.port = serverPort;
      }

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

          botData.antiAfk = new AntiAfk(bot);

          resolve();
        }
      });

      bot.on('spawn', () => {
        this.emitChatMessage(botData.id, 'system', '🎮 Spawn noktasına ışınlandı.');
      });

      bot.on('chat', (username, message) => {
        if (username === bot.username) return;
        this.emitChatMessage(botData.id, 'chat', `[${username}] ${message}`);
      });

      bot.on('message', (jsonMsg, position) => {
        if (position === 'game_info') return;

        const text = extractChatText(jsonMsg);
        if (text && text.trim() && text !== '[object Object]') {
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

        if (botData.antiAfk) {
          botData.antiAfk.stop();
        }
      });
    });
  }

  // ── Oyuncu Listesi ──────────────────────────────────────────

  _updatePlayerList(botData) {
    if (!botData.instance || !botData.instance.players) return;

    botData.players = Object.values(botData.instance.players).map(p => ({
      username: p.username,
      ping: p.ping || 0,
      uuid: p.uuid
    }));
  }

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

  /**
   * Sunucudaki tüm botlara mesaj gönder
   */
  broadcastMessage(serverKey, message) {
    let sent = 0;
    let failed = 0;

    for (const [id, botData] of this.bots) {
      if (botData.serverKey === serverKey && botData.status === 'online') {
        try {
          botData.instance.chat(message);
          this.emitChatMessage(id, 'self', `→ ${message}`);
          sent++;
        } catch (err) {
          failed++;
        }
      }
    }

    if (sent === 0) {
      return { success: false, message: 'Gönderilecek aktif bot bulunamadı.' };
    }

    return { success: true, message: `${sent} bot'a mesaj gönderildi.${failed > 0 ? ` (${failed} başarısız)` : ''}` };
  }

  // ── Bot Hareket Kontrolü ────────────────────────────────────

  handleBotMove(botId, action, state) {
    const botData = this.bots.get(botId);
    if (!botData) {
      return { success: false, message: 'Bot bulunamadı.' };
    }
    if (!botData.instance || botData.status !== 'online') {
      return { success: false, message: 'Bot çevrimdışı.' };
    }

    const bot = botData.instance;

    try {
      switch (action) {
        case 'forward':
        case 'back':
        case 'left':
        case 'right':
          bot.setControlState(action, state);
          break;
        case 'jump':
          bot.setControlState('jump', state);
          break;
        case 'sneak':
          bot.setControlState('sneak', state);
          break;
        case 'sprint':
          bot.setControlState('sprint', state);
          break;
        case 'look':
          if (state && typeof state.yaw === 'number' && typeof state.pitch === 'number') {
            bot.look(state.yaw, state.pitch, true);
          }
          break;
        case 'lookYaw':
          if (typeof state === 'number') {
            const currentPitch = bot.entity.pitch || 0;
            bot.look(state, currentPitch, true);
          }
          break;
        case 'lookPitch':
          if (typeof state === 'number') {
            const currentYaw = bot.entity.yaw || 0;
            bot.look(currentYaw, state, true);
          }
          break;
        case 'dig':
          if (state === true) {
            // Gerçek blok kırma - imleç altındaki bloğu bul ve kır
            const block = bot.blockAtCursor(4);
            if (block && block.type !== 'air') {
              bot.dig(block, 'ignore')
                .then(() => {
                  this.emitChatMessage(botId, 'system', `⛏️ Blok kırıldı: ${block.displayName || block.name}`);
                })
                .catch(err => {
                  this.emitChatMessage(botId, 'error', `❌ Kırma hatası: ${err.message}`);
                });
              this.emitChatMessage(botId, 'system', `⛏️ Blok kırılıyor: ${block.displayName || block.name}...`);
            } else {
              this.emitChatMessage(botId, 'error', '❌ Kırılacak blok bulunamadı (imlecinizin altında blok yok).');
            }
          }
          break;
        case 'place':
          if (state && typeof state === 'object' && state.x !== undefined) {
            const refBlock = bot.blockAt(state);
            if (refBlock) {
              const vec = new (require('vec3'))(0, 1, 0);
              bot.placeBlock(refBlock, vec);
            }
          }
          break;
        case 'useItem':
          bot.activateItem();
          break;
        case 'swing':
          bot.swingArm('right');
          break;
        case 'tp':
          if (state && typeof state === 'object' && state.x !== undefined) {
            bot.chat(`/tp ${bot.username} ${state.x} ${state.y} ${state.z}`);
          }
          break;
        default:
          return { success: false, message: `Bilinmeyen hareket: ${action}` };
      }

      return { success: true };
    } catch (err) {
      return { success: false, message: `Hareket hatası: ${err.message}` };
    }
  }

  // ── Bot Script Çalıştırma ───────────────────────────────────

  runBotScript(botId, script) {
    const botData = this.bots.get(botId);
    if (!botData) {
      return { success: false, message: 'Bot bulunamadı.' };
    }
    if (!botData.instance || botData.status !== 'online') {
      return { success: false, message: 'Bot çevrimdışı.' };
    }

    // Eski runner'ı temizle
    const oldRunner = this.scriptRunners.get(botId);
    if (oldRunner) {
      oldRunner.stop();
      this.scriptRunners.delete(botId);
    }

    const runner = new ScriptRunner(this, botId, botData.instance);
    this.scriptRunners.set(botId, runner);

    const result = runner.run(script);
    if (result.success) {
      this.emitBotUpdate();
    }
    return result;
  }

  stopBotScript(botId) {
    const runner = this.scriptRunners.get(botId);
    if (!runner) {
      return { success: false, message: 'Çalışan script bulunamadı.' };
    }

    const result = runner.stop();
    this.scriptRunners.delete(botId);
    this.emitBotUpdate();
    return result;
  }

  getScriptStatus(botId) {
    const runner = this.scriptRunners.get(botId);
    if (!runner) {
      return { success: true, isRunning: false };
    }
    return { success: true, ...runner.getStatus() };
  }

  // ── Anti-AFK ────────────────────────────────────────────────

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

    return { success: true, message: `Anti-AFK ${enabled ? 'açıldı' : 'kapandı'}.` };
  }

  /**
   * Sunucudaki tüm botlarda Anti-AFK toggle
   */
  toggleAllAntiAfk(serverKey, enabled) {
    let toggled = 0;

    for (const [id, botData] of this.bots) {
      if (botData.serverKey === serverKey && botData.status === 'online' && botData.antiAfk) {
        if (enabled) {
          botData.antiAfk.start();
          this.emitChatMessage(id, 'system', '🛡️ Anti-AFK aktifleştirildi.');
        } else {
          botData.antiAfk.stop();
          this.emitChatMessage(id, 'system', '🛡️ Anti-AFK devre dışı bırakıldı.');
        }
        toggled++;
      }
    }

    this.emitBotUpdate();

    if (toggled === 0) {
      return { success: false, message: 'Aktif bot bulunamadı.' };
    }

    return { success: true, message: `${toggled} bot'ta Anti-AFK ${enabled ? 'açıldı' : 'kapandı'}.` };
  }

  // ── Bot Çıkarma ─────────────────────────────────────────────

  removeBot(botId) {
    const botData = this.bots.get(botId);
    if (!botData) {
      return { success: false, message: 'Bot bulunamadı.' };
    }

    this._cleanupBot(botId);
    return { success: true, message: `"${botData.name}" botu çıkarıldı.` };
  }

  /**
   * Sunucudaki tüm botları çıkar
   */
  removeServerBots(serverKey) {
    let removed = 0;
    const toRemove = [];

    for (const [id, botData] of this.bots) {
      if (botData.serverKey === serverKey) {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      this._cleanupBot(id);
      removed++;
    }

    if (removed === 0) {
      return { success: false, message: 'Bu sunucuda bot bulunamadı.' };
    }

    return { success: true, message: `${removed} bot çıkarıldı.` };
  }

  _cleanupBot(botId) {
    const botData = this.bots.get(botId);
    if (!botData) return;

    // Çalışan script'i durdur
    const runner = this.scriptRunners.get(botId);
    if (runner) {
      runner.stop();
      this.scriptRunners.delete(botId);
    }

    if (botData.connectTimeout) {
      clearTimeout(botData.connectTimeout);
    }

    if (botData.antiAfk) {
      botData.antiAfk.stop();
    }

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

  destroyAll() {
    for (const [botId] of this.bots) {
      this._cleanupBot(botId);
    }
  }

  // ── Socket.io Yayınları ─────────────────────────────────────

  emitBotUpdate() {
    this.io.emit('bot-update', this.getAllBots());
    this.io.emit('server-bots', this.getBotsByServer());
  }

  emitChatMessage(botId, type, text) {
    const timestamp = new Date().toLocaleTimeString('tr-TR');
    this.io.emit('chat-message', { botId, type, text, timestamp });
  }
}

module.exports = BotManager;
