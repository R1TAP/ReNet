const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Set application name
app.name = 'ReNet';

const configManager = require('./core/config');
const deviceManager = require('./core/device');
const gnirehtetManager = require('./core/gnirehtet');
const trayManager = require('./tray');

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

let mainWindow = null;
let isCleaningUp = false;
let isCleanlyExited = false;

// Determine true executable path (fixing Portable exe path bug)
const realExePath = process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe');
const isHiddenLaunch = process.argv.includes('--hidden');

function getAppIcon() {
  const candidates = [
    path.join(__dirname, '..', 'assets', 'icon.ico'),
    path.join(__dirname, '..', 'assets', 'icon.png')
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'ReNet',
    width: 900,
    height: 1025,
    minWidth: 720,
    minHeight: 700,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#101217',
    icon: getAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (!isHiddenLaunch) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  mainWindow.on('maximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:maximized', true);
    }
  });

  mainWindow.on('unmaximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:maximized', false);
    }
  });

  mainWindow.on('close', (event) => {
    if (!isCleanlyExited && configManager.get('minimizeToTray')) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // Handle second instance activation
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function setupIPC() {
  ipcMain.handle('renet:start', async (_event, options) => {
    const config = configManager.getAll();
    const opts = {
      serial: options?.serial !== undefined ? options.serial : config.selectedDevice,
      dns: options?.dns || config.dns,
      port: options?.port || config.port,
      route: options?.route || config.route
    };
    return await gnirehtetManager.start(opts);
  });

  ipcMain.handle('renet:stop', async () => {
    return await gnirehtetManager.stop();
  });

  ipcMain.handle('renet:get-status', () => {
    return gnirehtetManager.getStatus();
  });

  ipcMain.handle('renet:get-devices', async () => {
    return await deviceManager.getDevices();
  });

  ipcMain.handle('renet:check-adb-version', async () => {
    return await deviceManager.checkAdbVersion();
  });

  ipcMain.handle('renet:restart-adb-server', async () => {
    return await deviceManager.restartAdbServer();
  });

  ipcMain.handle('renet:kill-process', (_event, pid) => {
    const targetPid = parseInt(pid, 10);
    if (!targetPid || isNaN(targetPid)) return { success: false, message: '无效的 PID' };
    const success = gnirehtetManager.killProcessTree(targetPid);
    return { success };
  });

  ipcMain.handle('renet:get-diagnostics', async () => {
    const adbVer = await deviceManager.checkAdbVersion();
    const devices = await deviceManager.getDevices();
    const status = gnirehtetManager.getStatus();
    const config = configManager.getAll();

    return {
      platform: `${os.type()} ${os.release()} (${os.arch()})`,
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      realExePath,
      isPortable: !!process.env.PORTABLE_EXECUTABLE_FILE,
      adbPath: deviceManager.getAdbPath(),
      adbVersion: adbVer.version || adbVer.error,
      devices,
      status,
      config
    };
  });

  ipcMain.handle('renet:get-config', () => {
    return configManager.getAll();
  });

  ipcMain.handle('renet:save-config', (_event, newConfig) => {
    const saved = configManager.save(newConfig);
    if (newConfig.autoStart !== undefined) {
      try {
        app.setLoginItemSettings({
          path: realExePath,
          args: ['--hidden'],
          openAtLogin: !!newConfig.autoStart,
          openAsHidden: true
        });
      } catch (err) {
        console.error('Failed to update loginItemSettings:', err);
      }
    }
    return saved;
  });

  // Window controls
  ipcMain.on('window:minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.on('window:maximize', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
  });

  ipcMain.on('window:close', () => {
    if (mainWindow) mainWindow.close();
  });
}

function setupEventListeners() {
  gnirehtetManager.on('state-changed', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('state:changed', data);
    }
  });

  gnirehtetManager.on('log', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('log:entry', data);
    }
  });

  deviceManager.on('devices-changed', (devices) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('devices:changed', devices);
    }

    // Auto-connect feature
    const isAutoConnect = configManager.get('autoConnect');
    const isRunning = gnirehtetManager.getStatus().isRunning;
    if (isAutoConnect && !isRunning && devices.length > 0) {
      const savedTarget = configManager.get('selectedDevice');
      let targetSerial = null;
      if (savedTarget === 'all') {
        targetSerial = 'all';
      } else if (savedTarget && devices.some(d => d.serial === savedTarget && d.state === 'device')) {
        targetSerial = savedTarget;
      } else {
        const readyDevice = devices.find(d => d.state === 'device');
        if (readyDevice) targetSerial = readyDevice.serial;
      }

      if (targetSerial) {
        const config = configManager.getAll();
        gnirehtetManager.start({
          serial: targetSerial,
          dns: config.dns,
          port: config.port,
          route: config.route
        });
      }
    }
  });
}

app.whenReady().then(() => {
  setupIPC();
  createWindow();
  setupEventListeners();

  trayManager.init(mainWindow, gnirehtetManager, configManager, realExePath, deviceManager);
  deviceManager.startPolling();
});

// Robust exit with watchdog & anti-reentrancy
app.on('before-quit', async (event) => {
  if (isCleanlyExited) return;

  event.preventDefault();
  if (isCleaningUp) return;
  isCleaningUp = true;

  // 5-second timeout watchdog
  const watchdog = setTimeout(() => {
    if (gnirehtetManager.spawnedPid) {
      gnirehtetManager.killProcessTree(gnirehtetManager.spawnedPid);
    }
    isCleanlyExited = true;
    app.exit(0);
  }, 5000);

  try {
    deviceManager.stopPolling();
    await gnirehtetManager.stop();
  } catch (err) {
    console.error('Error during exit cleanup:', err);
  } finally {
    clearTimeout(watchdog);
    isCleanlyExited = true;
    app.exit(0);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (!configManager.get('minimizeToTray')) {
      app.quit();
    }
  }
});
