const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class ConfigManager {
  constructor() {
    try {
      this.configPath = path.join(app.getPath('userData'), 'renet-config.json');
    } catch {
      this.configPath = path.join(process.cwd(), 'renet-config.json');
    }

    this.defaultConfig = {
      dns: '223.5.5.5,119.29.29.29',
      port: 31416,
      route: '',
      autoConnect: false,
      minimizeToTray: true,
      autoStart: false,
      selectedDevice: '',
      adbMode: 'bundled', // 'bundled' | 'system' | 'custom'
      customAdbPath: '',
      theme: 'system'
    };

    this.config = this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf8');
        return { ...this.defaultConfig, ...JSON.parse(raw) };
      }
    } catch (err) {
      console.error('[Config] Failed to load config, falling back to default:', err);
    }
    return { ...this.defaultConfig };
  }

  save(newConfig) {
    try {
      this.config = { ...this.config, ...newConfig };
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // Atomic write using temp file
      const tempPath = `${this.configPath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.config, null, 2), 'utf8');
      fs.renameSync(tempPath, this.configPath);
      return true;
    } catch (err) {
      console.error('[Config] Failed to save config:', err);
      return false;
    }
  }

  get(key) {
    return this.config[key];
  }

  getAll() {
    return { ...this.config };
  }
}

module.exports = new ConfigManager();
