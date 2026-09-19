const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const configManager = require('./config');

class DeviceManager extends EventEmitter {
  constructor() {
    super();
    this.devices = [];
    this.deviceCache = new Map();
    this.pollingTimer = null;
    this.isPolling = false;
    this.adbVersionInfo = null;
  }

  resolveAdbPath() {
    const config = configManager.getAll();
    const mode = config.adbMode || 'bundled';

    if (mode === 'custom' && config.customAdbPath && fs.existsSync(config.customAdbPath)) {
      return config.customAdbPath;
    }

    if (mode === 'system') {
      return 'adb.exe';
    }

    // Bundled mode (default)
    const candidateDirs = [
      process.resourcesPath ? path.resolve(process.resourcesPath, 'bin', 'adb.exe') : null,
      path.resolve(__dirname, '..', '..', '..', 'bin', 'adb.exe'),
      path.resolve(__dirname, '..', '..', '..', 'Gnirehtet', 'adb.exe'),
      path.resolve(process.cwd(), 'bin', 'adb.exe'),
      path.resolve(process.cwd(), 'Gnirehtet', 'adb.exe'),
      'adb.exe'
    ].filter(Boolean);

    for (const p of candidateDirs) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
    return 'adb.exe';
  }

  getAdbPath() {
    return this.resolveAdbPath();
  }

  execAdb(args, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const adbPath = this.resolveAdbPath();
      execFile(adbPath, args, { timeout, windowsHide: true }, (err, stdout, stderr) => {
        if (err) {
          return reject(err);
        }
        resolve({ stdout: stdout ? stdout.trim() : '', stderr: stderr ? stderr.trim() : '' });
      });
    });
  }

  async checkAdbVersion() {
    try {
      const { stdout } = await this.execAdb(['version']);
      this.adbVersionInfo = stdout;
      return { success: true, version: stdout };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async getDevices() {
    try {
      const { stdout } = await this.execAdb(['devices', '-l']);
      const lines = stdout.split(/\r?\n/);
      const devices = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('List of devices attached')) continue;

        const parts = trimmed.split(/\s+/);
        if (parts.length >= 2) {
          const serial = parts[0];
          const state = parts[1];

          let model = '';
          let product = '';
          for (let i = 2; i < parts.length; i++) {
            if (parts[i].startsWith('model:')) {
              model = parts[i].substring('model:'.length).replace(/_/g, ' ');
            } else if (parts[i].startsWith('product:')) {
              product = parts[i].substring('product:'.length);
            }
          }

          let cached = this.deviceCache.get(serial) || {};
          let detailedModel = cached.model || model || serial;
          let androidVersion = cached.version || '';

          if (state === 'device' && (!cached.model || !cached.version)) {
            try {
              const [mRes, vRes] = await Promise.allSettled([
                this.execAdb(['-s', serial, 'shell', 'getprop', 'ro.product.model'], 2000),
                this.execAdb(['-s', serial, 'shell', 'getprop', 'ro.build.version.release'], 2000)
              ]);
              if (mRes.status === 'fulfilled' && mRes.value.stdout) {
                detailedModel = mRes.value.stdout;
              }
              if (vRes.status === 'fulfilled' && vRes.value.stdout) {
                androidVersion = vRes.value.stdout;
              }
              this.deviceCache.set(serial, { model: detailedModel, version: androidVersion });
            } catch {
              // Ignore
            }
          }

          devices.push({
            serial,
            state,
            model: detailedModel,
            product,
            androidVersion
          });
        }
      }

      const prevSerials = this.devices.map(d => `${d.serial}:${d.state}`).sort().join(',');
      const currSerials = devices.map(d => `${d.serial}:${d.state}`).sort().join(',');

      this.devices = devices;

      if (prevSerials !== currSerials) {
        this.emit('devices-changed', devices);
      }

      return devices;
    } catch (err) {
      console.error('[DeviceManager] Error listing devices:', err.message);
      return [];
    }
  }

  // Targeted reverse tunnel removal ONLY for Gnirehtet - NEVER remove other tools' tunnels!
  async removeGnirehtetTunnel(serial) {
    try {
      if (serial && serial !== 'all' && serial !== 'All Devices' && serial !== '全部设备 (AutoRun)') {
        await this.execAdb(['-s', serial, 'reverse', '--remove', 'localabstract:gnirehtet'], 3000);
      } else {
        // If all devices / autorun, remove tunnel for each connected device individually
        const devices = await this.getDevices();
        await Promise.allSettled(
          devices.map(d => this.execAdb(['-s', d.serial, 'reverse', '--remove', 'localabstract:gnirehtet'], 2000))
        );
      }
      return { success: true };
    } catch (err) {
      // If tunnel doesn't exist, ignore
      return { success: false, error: err.message };
    }
  }

  // Safe ADB server restart (Only invoked after user confirms impact in UI)
  async restartAdbServer() {
    try {
      await this.execAdb(['kill-server'], 5000);
      await this.execAdb(['start-server'], 5000);
      await this.getDevices();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  startPolling(intervalMs = 2500) {
    if (this.pollingTimer) return;
    this.getDevices();
    this.pollingTimer = setInterval(async () => {
      if (this.isPolling) return;
      this.isPolling = true;
      try {
        await this.getDevices();
      } finally {
        this.isPolling = false;
      }
    }, intervalMs);
  }

  stopPolling() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }
}

module.exports = new DeviceManager();
