/**
 * Anti-AFK Modülü - Minecraft AFK Client
 * 
 * Botun AFK kick'inden kaçınması için:
 * - Rastgele kafa çevirme (2-5 sn arası)
 * - Rastgele eğilip kalkma (15-30 sn arası)
 * - Boş ele sağ tık animasyonu (30-60 sn arası)
 * 
 * Bot ASLA yürümez!
 */

/**
 * Belirtilen aralıkta rastgele tam sayı üretir
 * @param {number} min - Minimum değer (dahil)
 * @param {number} max - Maksimum değer (dahil)
 * @returns {number}
 */
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Belirtilen süre kadar bekler
 * @param {number} ms - Milisaniye
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Anti-AFK Sınıfı ─────────────────────────────────────────────
class AntiAfk {
  /**
   * @param {Object} bot - Mineflayer bot instance
   */
  constructor(bot) {
    this.bot = bot;
    this.isRunning = false;
    this.abortController = null;

    // Aktif zamanlayıcılar (cleanup için)
    this.timeouts = [];
    this.intervals = [];
  }

  // ── Başlat / Durdur ─────────────────────────────────────────

  /**
   * Anti-AFK döngüsünü başlatır
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    console.log(`[AntiAfk] ${this.bot.username} için başlatıldı.`);

    // Her eylem kendi bağımsız zamanlayıcısını yönetir
    this._scheduleHeadTurn(signal);
    this._scheduleSneak(signal);
    this._scheduleArmSwing(signal);
  }

  /**
   * Anti-AFK döngüsünü durdurur
   */
  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;

    // AbortController ile tüm bekleyen işlemleri iptal et
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Tüm zamanlayıcıları temizle
    this.timeouts.forEach(t => clearTimeout(t));
    this.intervals.forEach(i => clearInterval(i));
    this.timeouts = [];
    this.intervals = [];

    // Eğilme durumunu sıfırla
    if (this.bot.entity) {
      this.bot.setControlState('sneak', false);
    }

    console.log(`[AntiAfk] ${this.bot.username} için durduruldu.`);
  }

  // ── Eylem Zamanlayıcıları ───────────────────────────────────

  /**
   * Kafa çevirme eylemini zamanlar (2-5 sn arası)
   */
  _scheduleHeadTurn(signal) {
    const run = async () => {
      if (signal.aborted || !this.isRunning) return;

      await this._performHeadTurn();

      if (signal.aborted || !this.isRunning) return;

      const nextDelay = randomInt(2000, 5000);
      const timeout = setTimeout(() => this._scheduleHeadTurn(signal), nextDelay);
      this.timeouts.push(timeout);
    };

    run();
  }

  /**
   * Eğilme eylemini zamanlar (15-30 sn arası)
   */
  _scheduleSneak(signal) {
    const run = async () => {
      if (signal.aborted || !this.isRunning) return;

      await this._performSneak();

      if (signal.aborted || !this.isRunning) return;

      const nextDelay = randomInt(15000, 30000);
      const timeout = setTimeout(() => this._scheduleSneak(signal), nextDelay);
      this.timeouts.push(timeout);
    };

    run();
  }

  /**
   * Kol sallama eylemini zamanlar (30-60 sn arası)
   */
  _scheduleArmSwing(signal) {
    const run = async () => {
      if (signal.aborted || !this.isRunning) return;

      await this._performArmSwing();

      if (signal.aborted || !this.isRunning) return;

      const nextDelay = randomInt(30000, 60000);
      const timeout = setTimeout(() => this._scheduleArmSwing(signal), nextDelay);
      this.timeouts.push(timeout);
    };

    run();
  }

  // ── Eylem Gerçekleştirme ────────────────────────────────────

  /**
   * Yumuşak kafa çevirme - bot yürümez, sadece bakış açısı değişir
   */
  async _performHeadTurn() {
    try {
      if (!this.bot.entity) return;

      // Mevcut yaw/pitch değerlerini al
      const currentYaw = this.bot.entity.yaw;
      const currentPitch = this.bot.entity.pitch;

      // Rastgele hedef değerler (-45° ile +45° arası değişim)
      const targetYaw = currentYaw + (Math.random() - 0.5) * Math.PI / 2;
      const targetPitch = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, 
        currentPitch + (Math.random() - 0.5) * Math.PI / 4));

      // Yumuşak geçiş - 300ms içinde
      const steps = 10;
      const stepDuration = 30;
      const yawStep = (targetYaw - currentYaw) / steps;
      const pitchStep = (targetPitch - currentPitch) / steps;

      for (let i = 1; i <= steps; i++) {
        if (!this.isRunning) break;
        this.bot.look(currentYaw + yawStep * i, currentPitch + pitchStep * i, true);
        await sleep(stepDuration);
      }
    } catch (err) {
      // Bot spawn olmamış olabilir, sessizce atla
    }
  }

  /**
   * Eğilip kalkma - 1-2 sn arası
   */
  async _performSneak() {
    try {
      if (!this.bot.entity) return;

      const sneakDuration = randomInt(1000, 2000);

      // Eğil
      this.bot.setControlState('sneak', true);
      await sleep(sneakDuration);

      // Kalk
      if (this.isRunning) {
        this.bot.setControlState('sneak', false);
      }
    } catch (err) {
      // Hata durumunda sneak'i sıfırla
      try {
        this.bot.setControlState('sneak', false);
      } catch (_) { /* ignore */ }
    }
  }

  /**
   * Boş ele sağ tık animasyonu (arm swing)
   */
  async _performArmSwing() {
    try {
      if (!this.bot.entity) return;

      // Sağ tık animasyonu tetikle
      this.bot.swingArm('right');

      // Kısa bekleme
      await sleep(200);

      // İkinci kez sallama (daha doğal görünür)
      if (this.isRunning) {
        await sleep(randomInt(300, 800));
        this.bot.swingArm('right');
      }
    } catch (err) {
      // Sessizce atla
    }
  }
}

module.exports = AntiAfk;
