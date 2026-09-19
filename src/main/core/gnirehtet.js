const { spawn, execFile, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { EventEmitter } = require('events');
const deviceManager = require('./device');

class GnirehtetManager extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.spawnedPid = null;
    this.state = 'STOPPED'; // 'STOPPED' | 'STARTING' | 'RUNNING' | 'STOPPING' | 'ERROR'
    this.currentDevice = null;
    this.activeParams = null;
    this.startTime = null;
    this.resolvedDir = null;
    this.gnirehtetExe = this.resolveGnirehtetPath();
  }

  resolveGnirehtetPath() {
    const candidateDirs = [
      process.resourcesPath ? path.resolve(process.resourcesPath, 'bin') : null,
      path.resolve(__dirname, '..', '..', '..', 'bin'),
      path.resolve(__dirname, '..', '..', '..', 'Gnirehtet'),
      path.resolve(process.cwd(), 'bin'),
      path.resolve(process.cwd(), 'Gnirehtet')
    ].filter(Boolean);

    for (const dir of candidateDirs) {
      const exe = path.resolve(dir, 'gnirehtet.exe');
      if (fs.existsSync(exe)) {
        this.resolvedDir = dir;
        return exe;
      }
    }

    this.resolvedDir = process.cwd();
    return 'gnirehtet.exe';
  }

  setState(newState, payload = {}) {
    this.state = newState;
    this.emit('state-changed', {
      state: this.state,
      device: this.currentDevice,
      startTime: this.startTime,
      ...payload
    });
  }

  getStatus() {
    return {
      state: this.state,
      isRunning: this.state === 'RUNNING' || this.state === 'STARTING',
      device: this.currentDevice,
      startTime: this.startTime,
      uptime: this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : 0,
      activeParams: this.activeParams
    };
  }

  // Check if a port is available on localhost
  checkPortAvailable(port) {
    return new Promise((resolve) => {
      const tester = net.createServer()
        .once('error', (err) => {
          if (err.code === 'EADDRINUSE') {
            resolve(false);
          } else {
            resolve(true);
          }
        })
        .once('listening', () => {
          tester.close(() => resolve(true));
        })
        .listen(port, '127.0.0.1');
    });
  }

  // Find detailed information about process occupying a port
  async getPortOccupier(port) {
    try {
      const cmd = `Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique`;
      const stdout = execSync(`powershell -NoProfile -Command "${cmd}"`, { encoding: 'utf8' }).trim();
      const pid = parseInt(stdout, 10);
      if (!pid || isNaN(pid)) return null;

      const pInfoCmd = `Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object ProcessId, Name, ExecutablePath, CommandLine | ConvertTo-Json -Compress`;
      const pInfoRaw = execSync(`powershell -NoProfile -Command "${pInfoCmd}"`, { encoding: 'utf8' }).trim();
      if (!pInfoRaw) return { pid };

      const info = JSON.parse(pInfoRaw);
      return {
        pid: info.ProcessId,
        name: info.Name,
        path: info.ExecutablePath || '',
        commandLine: info.CommandLine || ''
      };
    } catch {
      return null;
    }
  }

  // Verify if a process belongs to ReNet
  isReNetProcess(procInfo) {
    if (!procInfo) return false;
    if (this.spawnedPid && procInfo.pid === this.spawnedPid) return true;

    const pPath = (procInfo.path || '').toLowerCase();
    const pCmd = (procInfo.commandLine || '').toLowerCase();

    // Check if path is in ReNet resources or Temp portable directory
    const appDir = path.resolve(__dirname, '..', '..', '..').toLowerCase();
    const resDir = (process.resourcesPath || '').toLowerCase();

    if (pPath.includes('renet') || (resDir && pPath.includes(resDir)) || pPath.includes(appDir)) {
      return true;
    }

    // Check temp unpack directory pattern
    if (pPath.includes('appdata\\local\\temp') && (pPath.includes('gnirehtet') || pCmd.includes('gnirehtet'))) {
      return true;
    }

    return false;
  }

  // Kill a specific process by PID with confirmation
  killProcessTree(pid) {
    try {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  startWatchdog(childPid, serial, adbPath) {
    try {
      const parentPid = process.pid;
      const psExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const isSpecific = serial && serial !== 'all' && serial !== 'All Devices' && serial !== '全部设备 (AutoRun)';
      const targetSerial = isSpecific ? serial : '';
      const resolvedAdb = (adbPath || 'adb.exe').replace(/'/g, "''");

      const cmd = `Wait-Process -Id ${parentPid} -ErrorAction SilentlyContinue; if (${childPid} -gt 0) { Stop-Process -Id ${childPid} -Force -ErrorAction SilentlyContinue }; if ('${targetSerial}') { & '${resolvedAdb}' -s '${targetSerial}' reverse --remove localabstract:gnirehtet 2>$null } else { & '${resolvedAdb}' reverse --remove localabstract:gnirehtet 2>$null }`;

      this.watchdogProcess = spawn(psExe, [
        '-NoProfile',
        '-WindowStyle', 'Hidden',
        '-Command', cmd
      ], {
        windowsHide: true,
        detached: true,
        stdio: 'ignore'
      });
      this.watchdogProcess.unref();
    } catch (err) {
      console.error('Failed to spawn watchdog:', err);
    }
  }

  async start({ serial, dns, port = 31416, route } = {}) {
    if (this.state === 'RUNNING' || this.state === 'STARTING') {
      return { success: false, message: 'Gnirehtet 正在运行中' };
    }

    // 1. Port occupancy inspection
    const isAvailable = await this.checkPortAvailable(port);
    if (!isAvailable) {
      const occupier = await this.getPortOccupier(port);
      if (occupier) {
        if (this.isReNetProcess(occupier)) {
          this.emit('log', {
            level: 'info',
            text: `[ReNet] 检测到上次残留的代理中继 (PID: ${occupier.pid})，正在安全回收...`
          });
          this.killProcessTree(occupier.pid);
          // Wait briefly for port release
          await new Promise(r => setTimeout(r, 400));
        } else {
          return {
            success: false,
            portOccupied: true,
            occupier,
            message: `端口 ${port} 已被外部程序占用 (PID: ${occupier.pid}, 程序: ${occupier.name || '未知'})。`
          };
        }
      }
    }

    this.gnirehtetExe = this.resolveGnirehtetPath();
    const adbPath = deviceManager.getAdbPath();
    const adbDir = path.dirname(adbPath);

    const isSpecificDevice = serial && serial !== 'all' && serial !== 'All Devices' && serial !== '全部设备 (AutoRun)';
    const args = [];
    if (isSpecificDevice) {
      args.push('run', serial);
    } else {
      args.push('autorun');
    }

    if (dns && dns.trim()) {
      args.push('-d', dns.trim());
    }

    if (port) {
      args.push('-p', String(port));
    }

    if (route && route.trim()) {
      args.push('-r', route.trim());
    }

    this.currentDevice = isSpecificDevice ? serial : '全部设备 (AutoRun)';
    this.activeParams = { serial: isSpecificDevice ? serial : 'all', dns, port, route };
    this.setState('STARTING');

    this.emit('log', {
      level: 'info',
      text: `[ReNet] 正在启动反向网络代理: ${path.basename(this.gnirehtetExe)} ${args.join(' ')}`
    });

    // Pre-clean any leftover tunnel from abnormal previous exit
    try {
      await deviceManager.removeGnirehtetTunnel(isSpecificDevice ? serial : null);
    } catch {}

    const env = { ...process.env };
    // Prefix both resolvedDir and adbDir to PATH so gnirehtet can seamlessly invoke adb
    const pathAdditions = [this.resolvedDir, adbDir].filter(Boolean).join(';');
    env.PATH = `${pathAdditions};${env.PATH || ''}`;

    try {
      this.process = spawn(this.gnirehtetExe, args, {
        cwd: this.resolvedDir || process.cwd(),
        env,
        windowsHide: true
      });

      this.spawnedPid = this.process.pid;
      this.startWatchdog(this.spawnedPid, serial, adbPath);

      this.process.stdout.on('data', (data) => {
        const lines = data.toString().split(/\r?\n/);
        for (const line of lines) {
          if (!line.trim()) continue;
          this.emit('log', { level: 'stdout', text: line });

          if (line.includes('Client started') || line.includes('Relay server started')) {
            if (this.state !== 'RUNNING') {
              this.startTime = Date.now();
              this.setState('RUNNING');
            }
          }
        }
      });

      this.process.stderr.on('data', (data) => {
        const lines = data.toString().split(/\r?\n/);
        for (const line of lines) {
          if (!line.trim()) continue;
          this.emit('log', { level: 'stderr', text: line });

          if (line.includes('Client started') || line.includes('Relay server started')) {
            if (this.state !== 'RUNNING') {
              this.startTime = Date.now();
              this.setState('RUNNING');
            }
          }
        }
      });

      this.process.on('error', (err) => {
        this.emit('log', { level: 'error', text: `[ReNet 错误] 进程启动失败: ${err.message}` });
        this.setState('ERROR', { error: err.message });
      });

      this.process.on('close', (code, signal) => {
        this.emit('log', {
          level: 'info',
          text: `[ReNet] 代理进程已退出 (代码: ${code}, 信号: ${signal})`
        });
        this.process = null;
        this.spawnedPid = null;
        this.startTime = null;
        this.setState('STOPPED');
      });

      setTimeout(() => {
        if (this.state === 'STARTING' && this.process && !this.process.killed) {
          this.startTime = Date.now();
          this.setState('RUNNING');
        }
      }, 2000);

      return { success: true };
    } catch (err) {
      this.setState('ERROR', { error: err.message });
      return { success: false, message: err.message };
    }
  }

  // Graceful stop with strict cleanup sequence
  async stop() {
    if (this.state === 'STOPPED' && !this.process && !this.spawnedPid) {
      return { success: true };
    }

    this.setState('STOPPING');
    this.emit('log', { level: 'info', text: '[ReNet] 正在关闭网络共享并清理隧道...' });

    const isSpecificDevice = this.currentDevice && this.currentDevice !== 'All Devices' && this.currentDevice !== 'all' && this.currentDevice !== '全部设备 (AutoRun)';
    const targetSerial = isSpecificDevice ? this.currentDevice : null;

    // 1. Send stop command to device to disable Android VpnService
    if (targetSerial) {
      try {
        await new Promise((resolve) => {
          execFile(this.gnirehtetExe, ['stop', targetSerial], {
            cwd: this.resolvedDir,
            windowsHide: true,
            timeout: 2500
          }, () => resolve());
        });
      } catch {
        // Ignore
      }
    } else {
      // If autorun across all devices, stop clients on all connected devices
      try {
        const devices = await deviceManager.getDevices();
        await Promise.allSettled(devices.map(d => new Promise((resolve) => {
          execFile(this.gnirehtetExe, ['stop', d.serial], {
            cwd: this.resolvedDir,
            windowsHide: true,
            timeout: 2000
          }, () => resolve());
        })));
      } catch {
        // Ignore
      }
    }

    // 2. Targeted tunnel removal (ONLY localabstract:gnirehtet)
    try {
      await deviceManager.removeGnirehtetTunnel(targetSerial);
    } catch {
      // Ignore
    }

    // 3. Terminate our spawned gnirehtet process tree
    if (this.spawnedPid) {
      this.killProcessTree(this.spawnedPid);
      this.spawnedPid = null;
    }

    if (this.process) {
      try {
        this.process.kill();
      } catch {}
      this.process = null;
    }

    if (this.watchdogProcess) {
      try {
        this.watchdogProcess.kill();
      } catch {}
      this.watchdogProcess = null;
    }

    this.startTime = null;
    this.setState('STOPPED');
    this.emit('log', { level: 'info', text: '[ReNet] 网络共享已安全断开，资源已完全释放' });
    return { success: true };
  }
}

module.exports = new GnirehtetManager();
