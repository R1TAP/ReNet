const { Tray, Menu, app, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

class TrayManager {
  constructor() {
    this.tray = null;
    this.mainWindow = null;
    this.gnirehtet = null;
    this.config = null;
    this.realExePath = null;
  }

  getIconPath(isActive = false) {
    const iconName = isActive ? 'icon-active.png' : 'icon.png';
    const candidates = [
      path.join(__dirname, '..', 'assets', iconName),
      path.join(__dirname, '..', 'assets', 'icon.png'),
      path.join(__dirname, '..', 'assets', 'icon.ico')
    ];

    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return '';
  }

  init(mainWindow, gnirehtet, config, realExePath, deviceManager) {
    this.mainWindow = mainWindow;
    this.gnirehtet = gnirehtet;
    this.config = config;
    this.realExePath = realExePath;
    this.deviceManager = deviceManager;

    const iconPath = this.getIconPath(false);
    let trayImage;
    if (iconPath) {
      trayImage = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    } else {
      trayImage = nativeImage.createEmpty();
    }

    this.tray = new Tray(trayImage);
    this.tray.setToolTip('ReNet - 手机反向网络代理');

    this.tray.on('click', () => {
      this.toggleWindow();
    });

    this.tray.on('double-click', () => {
      this.showWindow();
    });

    this.updateMenu();

    this.gnirehtet.on('state-changed', () => {
      this.updateMenu();
    });

    if (this.deviceManager) {
      this.deviceManager.on('devices-changed', () => {
        this.updateMenu();
      });
    }
  }

  showWindow() {
    if (this.mainWindow) {
      if (this.mainWindow.isMinimized()) this.mainWindow.restore();
      this.mainWindow.show();
      this.mainWindow.focus();
    }
  }

  toggleWindow() {
    if (!this.mainWindow) return;
    if (this.mainWindow.isVisible()) {
      this.mainWindow.hide();
    } else {
      this.showWindow();
    }
  }

  updateMenu() {
    if (!this.tray) return;

    const status = this.gnirehtet.getStatus();
    const isRunning = status.isRunning;
    const deviceName = status.device || 'Android 设备';

    const tooltip = isRunning
      ? `ReNet - 正在共享网络 (${deviceName})`
      : 'ReNet - 空闲 (待命中)';
    this.tray.setToolTip(tooltip);

    const activeIconPath = this.getIconPath(isRunning);
    if (activeIconPath) {
      try {
        const img = nativeImage.createFromPath(activeIconPath).resize({ width: 16, height: 16 });
        this.tray.setImage(img);
      } catch {}
    }

    const isAutoStart = app.getLoginItemSettings().openAtLogin;
    const devices = this.deviceManager ? (this.deviceManager.devices || []) : [];
    const currentTarget = this.config ? (this.config.get('selectedDevice') || (devices[0]?.serial || '')) : '';

    let deviceSubmenu = [];
    if (devices.length > 0) {
      deviceSubmenu = devices.map(d => ({
        label: `${d.model || d.serial} (${d.serial})${d.state !== 'device' ? ' [未授权]' : ''}`,
        type: 'radio',
        checked: currentTarget === d.serial,
        enabled: !isRunning && d.state === 'device',
        click: () => {
          this.config.save({ selectedDevice: d.serial });
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('devices:changed', this.deviceManager.devices);
          }
          this.updateMenu();
        }
      }));

      if (devices.length > 1) {
        deviceSubmenu.push({
          label: '🌐 全部设备 (AutoRun 同时共享)',
          type: 'radio',
          checked: currentTarget === 'all',
          enabled: !isRunning,
          click: () => {
            this.config.save({ selectedDevice: 'all' });
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              this.mainWindow.webContents.send('devices:changed', this.deviceManager.devices);
            }
            this.updateMenu();
          }
        });
      }
    } else {
      deviceSubmenu = [{ label: '未检测到可用 Android 设备', enabled: false }];
    }

    const contextMenu = Menu.buildFromTemplate([
      {
        label: `ReNet (${isRunning ? '运行中' : '未连接'})`,
        enabled: false
      },
      { type: 'separator' },
      {
        label: '显示主界面',
        click: () => this.showWindow()
      },
      {
        label: isRunning ? '断开网络共享' : '启动网络共享',
        click: async () => {
          if (isRunning) {
            await this.gnirehtet.stop();
          } else {
            const savedConfig = this.config.getAll();
            const target = savedConfig.selectedDevice || (devices[0]?.serial || '');
            await this.gnirehtet.start({
              serial: target,
              dns: savedConfig.dns,
              port: savedConfig.port,
              route: savedConfig.route
            });
          }
        }
      },
      {
        label: '共享目标设备',
        submenu: deviceSubmenu,
        enabled: !isRunning
      },
      { type: 'separator' },
      {
        label: '开机自动启动 (静默常驻)',
        type: 'checkbox',
        checked: isAutoStart,
        click: (menuItem) => {
          try {
            app.setLoginItemSettings({
              path: this.realExePath || app.getPath('exe'),
              args: ['--hidden'],
              openAtLogin: menuItem.checked,
              openAsHidden: true
            });
            this.config.save({ autoStart: menuItem.checked });
          } catch (err) {
            console.error('Failed to set login item settings:', err);
          }
        }
      },
      { type: 'separator' },
      {
        label: '退出 ReNet',
        click: () => {
          app.quit();
        }
      }
    ]);

    this.tray.setContextMenu(contextMenu);
  }
}

module.exports = new TrayManager();
