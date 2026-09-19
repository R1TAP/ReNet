const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('renetApi', {
  // Core controls
  startSharing: (options) => ipcRenderer.invoke('renet:start', options),
  stopSharing: () => ipcRenderer.invoke('renet:stop'),
  getStatus: () => ipcRenderer.invoke('renet:get-status'),

  // Devices & Diagnostics
  getDevices: () => ipcRenderer.invoke('renet:get-devices'),
  checkAdbVersion: () => ipcRenderer.invoke('renet:check-adb-version'),
  restartAdbServer: () => ipcRenderer.invoke('renet:restart-adb-server'),
  killProcess: (pid) => ipcRenderer.invoke('renet:kill-process', pid),
  getDiagnostics: () => ipcRenderer.invoke('renet:get-diagnostics'),

  // Config
  getConfig: () => ipcRenderer.invoke('renet:get-config'),
  saveConfig: (cfg) => ipcRenderer.invoke('renet:save-config', cfg),

  // Window controls
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  onWindowMaximized: (callback) => {
    const handler = (_event, isMax) => callback(isMax);
    ipcRenderer.on('window:maximized', handler);
    return () => ipcRenderer.removeListener('window:maximized', handler);
  },

  // Subscriptions
  onDevicesChanged: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('devices:changed', handler);
    return () => ipcRenderer.removeListener('devices:changed', handler);
  },

  onStateChanged: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('state:changed', handler);
    return () => ipcRenderer.removeListener('state:changed', handler);
  },

  onLog: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('log:entry', handler);
    return () => ipcRenderer.removeListener('log:entry', handler);
  }
});
