/**
 * Anti-AFK Modülü - Minecraft AFK Client v3.0
 * 
 * Botun AFK kick'inden kaçınması için:
 * - Rastgele kafa çevirme (2-5 sn arası)
 * - Rastgele eğilip kalkma (15-30 sn arası)
 * - Boş ele sağ tık animasyonu (30-60 sn arası)
 * 
 * Bot ASLA yürümez!
 */

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class AntiAfk {
  constructor(bot) {
    this.bot = bot;
    this.isRunning = false;
    this.abortController = null;
    this.timeouts = [];
    this.intervals = [];
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    console.log(`[AntiAfk] ${this.bot.username} için başlatıldı.`);

    this._scheduleHeadTurn(signal);
    this._scheduleSneak(signal);
    this._scheduleArmSwing(signal);
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    this.timeouts.forEach(t => clearTimeout(t));
    this.intervals.forEach(i => clearInterval(i));
    this.timeouts = [];
    this.intervals = [];

    if (this.bot.entity) {
      this.bot.setControlState('sneak', false);
    }

    console.log(`[AntiAfk] ${this.bot.username} için durduruldu.`);
  }

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

  async _performHeadTurn() {
    try {
      if (!this.bot.entity) return;
      const currentYaw = this.bot.entity.yaw;
      const currentPitch = this.bot.entity.pitch;
      const targetYaw = currentYaw + (Math.random() - 0.5) * Math.PI / 2;
      const targetPitch = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, 
        currentPitch + (Math.random() - 0.5) * Math.PI / 4));

      const steps = 10;
      const stepDuration = 30;
      const yawStep = (targetYaw - currentYaw) / steps;
      const pitchStep = (targetPitch - currentPitch) / steps;

      for (let i = 1; i <= steps; i++) {
        if (!this.isRunning) break;
        this.bot.look(currentYaw + yawStep * i, currentPitch + pitchStep * i, true);
        await sleep(stepDuration);
      }
    } catch (err) {}
  }

  async _performSneak() {
    try {
      if (!this.bot.entity) return;
      const sneakDuration = randomInt(1000, 2000);
      this.bot.setControlState('sneak', true);
      await sleep(sneakDuration);
      if (this.isRunning) {
        this.bot.setControlState('sneak', false);
      }
    } catch (err) {
      try { this.bot.setControlState('sneak', false); } catch (_) {}
    }
  }

  async _performArmSwing() {
    try {
      if (!this.bot.entity) return;
      this.bot.swingArm('right');
      await sleep(200);
      if (this.isRunning) {
        await sleep(randomInt(300, 800));
        this.bot.swingArm('right');
      }
    } catch (err) {}
  }
}

module.exports = AntiAfk;
