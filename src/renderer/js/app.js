// App Controller - State Machine & IPC Logic
class AppController {
  constructor() {
    this.currentState = 'STOPPED';
    this.devices = [];
    this.currentDevice = null;
    this.selectedSerial = ''; // serial or 'all'
    this.timerInterval = null;
    this.startTime = null;
    this.config = {};

    this.dom = {
      heroCard: document.getElementById('hero-card'),
      heroIcon: document.getElementById('hero-icon'),
      heroTitle: document.getElementById('hero-title'),
      heroDeviceLabel: document.getElementById('hero-device-label'),
      deviceSelect: document.getElementById('device-select'),
      customDeviceBtn: document.getElementById('custom-device-btn'),
      customDeviceText: document.getElementById('custom-device-text'),
      customDeviceMenu: document.getElementById('custom-device-menu'),
      heroSelectWrapper: document.getElementById('hero-select-wrapper'),
      deviceCountChip: document.getElementById('device-count-chip'),
      heroTimer: document.getElementById('hero-timer'),
      btnToggleShare: document.getElementById('btn-toggle-share'),
      btnToggleIcon: document.getElementById('btn-toggle-icon'),
      btnToggleText: document.getElementById('btn-toggle-text'),
      globalStatusChip: document.getElementById('global-status-chip'),
      deviceName: document.getElementById('device-name'),
      deviceSub: document.getElementById('device-sub'),
      deviceChip: document.getElementById('device-chip'),
      deviceChipsContainer: document.getElementById('device-chips-container'),
      relayPortLabel: document.getElementById('relay-port-label'),
      relayChip: document.getElementById('relay-chip'),
      dnsLabel: document.getElementById('dns-label'),
      dnsSub: document.getElementById('dns-sub'),
      // Settings elements
      settingDnsPreset: document.getElementById('setting-dns-preset'),
      groupCustomDns: document.getElementById('group-custom-dns'),
      settingCustomDns: document.getElementById('setting-custom-dns'),
      settingPort: document.getElementById('setting-port'),
      settingAdbMode: document.getElementById('setting-adb-mode'),
      groupCustomAdb: document.getElementById('group-custom-adb'),
      settingCustomAdb: document.getElementById('setting-custom-adb'),
      settingAutoConnect: document.getElementById('setting-auto-connect'),
      settingMinimizeTray: document.getElementById('setting-minimize-tray'),
      settingAutoStart: document.getElementById('setting-auto-start'),
      btnSaveSettings: document.getElementById('btn-save-settings'),
      // Diagnostics buttons
      btnDiagAdbVer: document.getElementById('btn-diag-adb-ver'),
      btnDiagRemoveTunnel: document.getElementById('btn-diag-remove-tunnel'),
      btnDiagCopyInfo: document.getElementById('btn-diag-copy-info'),
      btnDiagRestartAdb: document.getElementById('btn-diag-restart-adb')
    };

    this.init();
  }

  async init() {
    this.initHeroFluid();
    this.bindEvents();
    this.initCustomDeviceDropdown();
    this.bindDiagnostics();
    await this.loadConfig();
    await this.loadDevices();
    await this.loadStatus();
    this.subscribeEvents();
  }

  initHeroFluid() {
    const heroCard = this.dom.heroCard;
    if (!heroCard || typeof HeroFluidGrid === 'undefined') return;
    try {
      this.fluidGrid = new HeroFluidGrid(heroCard, {
        pixelSize: 6.5,
        pixelGap: 2.0,
        threshold: 0.87,
        speed: 0.20,
        color1: [90 / 255, 175 / 255, 255 / 255],
        color2: [220 / 255, 240 / 255, 255 / 255],
        tileAlpha: 0.85
      });
      if (this.fluidGrid && this.fluidGrid.canvas) {
        this.fluidGrid.canvas.style.opacity = '0.40';
      }
    } catch (err) {
      console.warn('HeroFluidGrid init error:', err);
    }
  }

  bindEvents() {
    this.dom.btnToggleShare.addEventListener('click', () => this.handleToggleShare());
    this.dom.btnSaveSettings.addEventListener('click', () => this.handleSaveSettings());
    this.dom.deviceSelect?.addEventListener('change', (e) => this.handleDeviceSelected(e.target.value));
  }

  bindDiagnostics() {
    this.dom.btnDiagAdbVer?.addEventListener('click', async () => {
      const res = await window.renetApi.checkAdbVersion();
      if (res.success) {
        window.renetUI.showToast(`ADB 版本: ${res.version.split('\n')[0]}`);
        window.renetLog.append({ level: 'info', text: `[诊断] ADB 版本信息: \n${res.version}` });
      } else {
        window.renetUI.showToast(`检测失败: ${res.error}`);
      }
    });

    this.dom.btnDiagRemoveTunnel?.addEventListener('click', async () => {
      const serial = this.currentDevice?.serial || null;
      window.renetLog.append({ level: 'info', text: `[诊断] 正在精准清理专属隧道 localabstract:gnirehtet...` });
      window.renetUI.showToast('正在清理 ReNet 专属网络隧道...');
      await window.renetApi.stopSharing();
      window.renetUI.showToast('专属隧道已清理完毕');
    });

    this.dom.btnDiagCopyInfo?.addEventListener('click', async () => {
      const diag = await window.renetApi.getDiagnostics();
      const report = JSON.stringify(diag, null, 2);
      try {
        await navigator.clipboard.writeText(report);
        window.renetUI.showToast('完整诊断信息已复制到剪贴板');
        window.renetLog.append({ level: 'info', text: '[诊断] 诊断报告已导出' });
      } catch {
        window.renetUI.showToast('复制失败');
      }
    });

    // Safe ADB Server restart with explicit confirmation dialog
    this.dom.btnDiagRestartAdb?.addEventListener('click', () => {
      window.renetUI.showConfirm({
        title: '⚠️ 确认重启 ADB 调试服务？',
        message: '重启 ADB 服务将强制中断当前电脑上所有正在使用 ADB 的外部工具（如 Android Studio、HBuilderX、投屏软件或调试器等）。确认要继续吗？',
        onConfirm: async () => {
          window.renetUI.showToast('正在重启 ADB 服务...');
          window.renetLog.append({ level: 'warn', text: '[警告] 用户确认：正在重启全局 ADB 服务...' });
          const res = await window.renetApi.restartAdbServer();
          if (res.success) {
            window.renetUI.showToast('ADB 服务已成功重启');
            window.renetLog.append({ level: 'info', text: '[ReNet] ADB 服务重启成功' });
            await this.loadDevices();
          } else {
            window.renetUI.showToast(`ADB 重启失败: ${res.error}`);
          }
        }
      });
    });
  }

  subscribeEvents() {
    window.renetApi.onStateChanged((data) => this.handleStateChanged(data));
    window.renetApi.onDevicesChanged((devices) => this.handleDevicesChanged(devices));
    window.renetApi.onLog((entry) => window.renetLog.append(entry));
  }

  async loadConfig() {
    try {
      this.config = await window.renetApi.getConfig();
      if (this.config.selectedDevice) {
        this.selectedSerial = this.config.selectedDevice;
      }
      this.populateSettingsForm();
      this.updateDnsDisplay();
      if (this.config.port) {
        this.dom.relayPortLabel.textContent = `127.0.0.1:${this.config.port}`;
      }
    } catch (err) {
      console.error('Failed to load config:', err);
    }
  }

  populateSettingsForm() {
    const dns = this.config.dns || '';
    const presetOptions = ['223.5.5.5,119.29.29.29', '8.8.8.8,8.8.4.4', '1.1.1.1,1.0.0.1', '180.76.76.76'];

    if (presetOptions.includes(dns)) {
      this.dom.settingDnsPreset.value = dns;
      this.dom.groupCustomDns.style.display = 'none';
    } else {
      this.dom.settingDnsPreset.value = 'custom';
      this.dom.settingCustomDns.value = dns;
      this.dom.groupCustomDns.style.display = 'flex';
    }

    this.dom.settingPort.value = this.config.port || 31416;
    this.dom.settingAdbMode.value = this.config.adbMode || 'bundled';
    this.dom.groupCustomAdb.style.display = this.dom.settingAdbMode.value === 'custom' ? 'flex' : 'none';
    this.dom.settingCustomAdb.value = this.config.customAdbPath || '';
    this.dom.settingAutoConnect.checked = !!this.config.autoConnect;
    this.dom.settingMinimizeTray.checked = this.config.minimizeToTray !== false;
    this.dom.settingAutoStart.checked = !!this.config.autoStart;
  }

  updateDnsDisplay() {
    const dns = this.config.dns || '223.5.5.5,119.29.29.29';
    if (dns.includes('223.5.5.5')) {
      this.dom.dnsLabel.textContent = '阿里公共 DNS';
    } else if (dns.includes('8.8.8.8')) {
      this.dom.dnsLabel.textContent = 'Google Public DNS';
    } else if (dns.includes('1.1.1.1')) {
      this.dom.dnsLabel.textContent = 'Cloudflare DNS';
    } else {
      this.dom.dnsLabel.textContent = '自定义 DNS';
    }
    this.dom.dnsSub.textContent = dns;
  }

  async handleSaveSettings() {
    let selectedDns = this.dom.settingDnsPreset.value;
    if (selectedDns === 'custom') {
      selectedDns = this.dom.settingCustomDns.value.trim() || '223.5.5.5';
    }

    const port = parseInt(this.dom.settingPort.value, 10) || 31416;
    const adbMode = this.dom.settingAdbMode.value;
    const customAdbPath = this.dom.settingCustomAdb.value.trim();
    const autoConnect = this.dom.settingAutoConnect.checked;
    const minimizeToTray = this.dom.settingMinimizeTray.checked;
    const autoStart = this.dom.settingAutoStart.checked;

    const newConfig = {
      dns: selectedDns,
      port,
      adbMode,
      customAdbPath,
      autoConnect,
      minimizeToTray,
      autoStart
    };

    const success = await window.renetApi.saveConfig(newConfig);
    if (success) {
      this.config = { ...this.config, ...newConfig };
      this.updateDnsDisplay();
      this.dom.relayPortLabel.textContent = `127.0.0.1:${port}`;
      window.renetUI.closeSettings();
      window.renetUI.showToast('配置已安全保存');
    } else {
      window.renetUI.showToast('配置保存失败');
    }
  }

  async loadDevices() {
    try {
      const devices = await window.renetApi.getDevices();
      this.handleDevicesChanged(devices);
    } catch (err) {
      console.error('Failed to get devices:', err);
    }
  }

  handleDeviceSelected(serial) {
    if (this.currentState === 'RUNNING' || this.currentState === 'STARTING') {
      window.renetUI.showToast('共享运行中，停止后可切换目标设备');
      return;
    }
    this.selectedSerial = serial;
    window.renetApi.saveConfig({ selectedDevice: serial });
    this.updateDeviceView();
  }

  handleDevicesChanged(devices) {
    this.devices = devices || [];

    // 1. Update device count chip
    if (this.dom.deviceCountChip) {
      this.dom.deviceCountChip.textContent = `${this.devices.length} 台设备`;
      this.dom.deviceCountChip.className = this.devices.length > 0 ? 'm3-chip active' : 'm3-chip idle';
    }

    // 2. Clear and rebuild select dropdown options safely
    const select = this.dom.deviceSelect;
    if (select) {
      while (select.firstChild) {
        select.removeChild(select.firstChild);
      }

      if (this.devices.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '等待 Android 设备接入...';
        select.appendChild(opt);
        this.selectedSerial = '';
      } else {
        for (const dev of this.devices) {
          const opt = document.createElement('option');
          opt.value = dev.serial;
          const statusText = dev.state === 'device' ? '就绪' : '⚠️未授权';
          const modelName = dev.model || dev.serial;
          opt.textContent = `📱 ${modelName} (${dev.serial}) - ${statusText}`;
          select.appendChild(opt);
        }

        // Add "All Devices" option
        const allOpt = document.createElement('option');
        allOpt.value = 'all';
        allOpt.textContent = `🌐 全部设备 (${this.devices.length}台全部共享 / AutoRun)`;
        select.appendChild(allOpt);

        // Determine which option should be selected
        const hasCurrentSelection = this.selectedSerial === 'all' || this.devices.some(d => d.serial === this.selectedSerial);
        if (!hasCurrentSelection) {
          if (this.config.selectedDevice && (this.config.selectedDevice === 'all' || this.devices.some(d => d.serial === this.config.selectedDevice))) {
            this.selectedSerial = this.config.selectedDevice;
          } else {
            const firstReady = this.devices.find(d => d.state === 'device');
            this.selectedSerial = firstReady ? firstReady.serial : this.devices[0].serial;
          }
        }
        select.value = this.selectedSerial;
      }
    }

    // 3. Rebuild quick chips in device card safely
    const chipsContainer = this.dom.deviceChipsContainer;
    if (chipsContainer) {
      while (chipsContainer.firstChild) {
        chipsContainer.removeChild(chipsContainer.firstChild);
      }

      if (this.devices.length > 0) {
        for (const dev of this.devices) {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = `device-quick-chip ${dev.serial === this.selectedSerial ? 'active' : ''}`;
          chip.dataset.serial = dev.serial;
          const unauthMarker = dev.state === 'unauthorized' ? ' ⚠️' : '';
          chip.textContent = `📱 ${dev.model || dev.serial}${unauthMarker}`;
          chip.title = `${dev.model || dev.serial} (${dev.serial}) - ${dev.state === 'device' ? '调试就绪' : '未授权'}`;
          chip.addEventListener('click', () => {
            this.handleDeviceSelected(dev.serial);
            if (this.dom.deviceSelect) this.dom.deviceSelect.value = dev.serial;
          });
          chipsContainer.appendChild(chip);
        }

        if (this.devices.length > 1) {
          const allChip = document.createElement('button');
          allChip.type = 'button';
          allChip.className = `device-quick-chip ${this.selectedSerial === 'all' ? 'active' : ''}`;
          allChip.dataset.serial = 'all';
          allChip.textContent = '🌐 全部设备';
          allChip.title = '同时为所有已连接设备共享网络 (AutoRun)';
          allChip.addEventListener('click', () => {
            this.handleDeviceSelected('all');
            if (this.dom.deviceSelect) this.dom.deviceSelect.value = 'all';
          });
          chipsContainer.appendChild(allChip);
        }
      }
    }

    this.updateDeviceView();
  }

  updateDeviceView() {
    // Synchronize select value
    if (this.dom.deviceSelect && this.selectedSerial) {
      this.dom.deviceSelect.value = this.selectedSerial;
    }

    // Synchronize custom dropdown
    this.syncCustomDeviceDropdown();

    // Synchronize chips active state
    if (this.dom.deviceChipsContainer) {
      const chips = this.dom.deviceChipsContainer.querySelectorAll('.device-quick-chip');
      chips.forEach(chip => {
        if (chip.dataset.serial === this.selectedSerial) {
          chip.classList.add('active');
        } else {
          chip.classList.remove('active');
        }
      });
    }

    if (this.devices.length === 0) {
      this.dom.deviceName.textContent = '未检测到设备';
      this.dom.deviceSub.textContent = '请通过 USB 数据线连接手机并开启 USB 调试';
      this.dom.deviceChip.className = 'm3-chip idle';
      this.dom.deviceChip.textContent = '未连接';
      if (this.currentState === 'STOPPED') {
        this.dom.heroDeviceLabel.textContent = '未检测到可用 Android 设备';
      }
      this.currentDevice = null;
      return;
    }

    if (this.selectedSerial === 'all') {
      this.currentDevice = { serial: 'all', model: '全部设备 (AutoRun)', state: 'device' };
      this.dom.deviceName.textContent = '全部已连接设备 (AutoRun)';
      this.dom.deviceSub.textContent = `共 ${this.devices.length} 台设备，将自动探测并全量共享网络代理`;
      this.dom.deviceChip.className = 'm3-chip active';
      this.dom.deviceChip.textContent = '全部共享';

      if (this.currentState === 'STOPPED') {
        this.dom.heroDeviceLabel.textContent = '就绪 • 自动探测全量共享网络代理';
      }
      return;
    }

    const device = this.devices.find(d => d.serial === this.selectedSerial) || this.devices[0];
    this.currentDevice = device;

    if (!device) return;

    if (device.state === 'unauthorized') {
      this.dom.deviceName.textContent = device.model || device.serial;
      this.dom.deviceSub.textContent = '⚠ 手机未授权！请在手机屏幕上点击【始终允许】';
      this.dom.deviceChip.className = 'm3-chip warning';
      this.dom.deviceChip.textContent = '未授权';
      if (this.currentState === 'STOPPED') {
        this.dom.heroDeviceLabel.textContent = '⚠ 手机未授权，请在屏幕上点击【始终允许】';
      }
    } else if (device.state === 'device') {
      const model = device.model || device.serial;
      const verText = device.androidVersion ? `Android ${device.androidVersion} • ` : '';
      const prodText = device.product ? `${device.product} • ` : '';
      this.dom.deviceName.textContent = model;
      this.dom.deviceSub.textContent = `${verText}${prodText}USB 调试已就绪`;
      this.dom.deviceChip.className = 'm3-chip active';
      this.dom.deviceChip.textContent = '已连接';

      if (this.currentState === 'STOPPED') {
        this.dom.heroDeviceLabel.textContent = `${verText}${prodText}USB 调试已就绪`;
      }
    }
  }

  async loadStatus() {
    try {
      const status = await window.renetApi.getStatus();
      this.handleStateChanged(status);
    } catch (err) {
      console.error('Failed to get status:', err);
    }
  }

  handleStateChanged(data) {
    this.currentState = data.state || 'STOPPED';

    if (this.currentState === 'RUNNING') {
      if (this.dom.deviceSelect) this.dom.deviceSelect.disabled = true;
      if (this.dom.customDeviceBtn) this.dom.customDeviceBtn.disabled = true;
      this.closeCustomDeviceMenu();
      if (this.dom.deviceChipsContainer) {
        this.dom.deviceChipsContainer.querySelectorAll('.device-quick-chip').forEach(c => c.disabled = true);
      }

      this.dom.heroCard.classList.add('running');
      this.dom.heroTitle.textContent = '正在给手机共享网络';
      const activeDevName = (data.device === 'all' || data.device === 'All Devices' || data.device === '全部设备 (AutoRun)')
        ? '全部设备 (AutoRun)'
        : (this.currentDevice?.model || data.device || 'Android 设备');
      this.dom.heroDeviceLabel.textContent = `已建立隧道: ${activeDevName}`;

      this.dom.btnToggleShare.className = 'm3-btn success large-hero';
      this.dom.btnToggleIcon.textContent = '■';
      this.dom.btnToggleText.textContent = '断开网络共享';

      this.dom.globalStatusChip.className = 'm3-chip active';
      this.dom.globalStatusChip.textContent = '● 共享中';

      this.dom.relayChip.className = 'm3-chip active';
      this.dom.relayChip.textContent = '已建立';

      this.startTime = data.startTime || Date.now();
      this.startTimer();

      if (this.fluidGrid) {
        this.fluidGrid.setOptions({
          threshold: 0.85,
          speed: 0.20,
          pixelSize: 6.5,
          pixelGap: 2.0
        });
        this.fluidGrid.setThemeState([50 / 255, 240 / 255, 140 / 255], [1.0, 1.0, 1.0]);
      }
    } else if (this.currentState === 'STARTING') {
      if (this.dom.deviceSelect) this.dom.deviceSelect.disabled = true;
      if (this.dom.customDeviceBtn) this.dom.customDeviceBtn.disabled = true;
      this.closeCustomDeviceMenu();
      if (this.dom.deviceChipsContainer) {
        this.dom.deviceChipsContainer.querySelectorAll('.device-quick-chip').forEach(c => c.disabled = true);
      }

      this.dom.heroCard.classList.remove('running');
      this.dom.heroTitle.textContent = '正在启动网络代理...';
      this.dom.btnToggleShare.className = 'm3-btn tonal large-hero';
      this.dom.btnToggleIcon.textContent = '◌';
      this.dom.btnToggleText.textContent = '正在连接...';

      this.dom.globalStatusChip.className = 'm3-chip warning';
      this.dom.globalStatusChip.textContent = '◌ 连接中';

      this.dom.relayChip.className = 'm3-chip warning';
      this.dom.relayChip.textContent = '启动中';
    } else if (this.currentState === 'STOPPING') {
      if (this.dom.deviceSelect) this.dom.deviceSelect.disabled = true;
      if (this.dom.customDeviceBtn) this.dom.customDeviceBtn.disabled = true;
      this.closeCustomDeviceMenu();
      this.dom.heroCard.classList.remove('running');
      this.dom.heroTitle.textContent = '正在断开连接...';
      this.dom.btnToggleShare.className = 'm3-btn tonal large-hero';
      this.dom.btnToggleIcon.textContent = '◌';
      this.dom.btnToggleText.textContent = '正在关闭...';
    } else { // STOPPED or ERROR
      if (this.dom.deviceSelect) this.dom.deviceSelect.disabled = false;
      if (this.dom.customDeviceBtn) this.dom.customDeviceBtn.disabled = (this.devices.length === 0);
      this.closeCustomDeviceMenu();
      if (this.dom.deviceChipsContainer) {
        this.dom.deviceChipsContainer.querySelectorAll('.device-quick-chip').forEach(c => c.disabled = false);
      }

      this.dom.heroCard.classList.remove('running');
      this.dom.heroTitle.textContent = '网络共享未开启';

      this.dom.btnToggleShare.className = 'm3-btn filled large-hero';
      this.dom.btnToggleIcon.textContent = '▶';
      this.dom.btnToggleText.textContent = '开启网络共享';

      this.dom.globalStatusChip.className = 'm3-chip idle';
      this.dom.globalStatusChip.textContent = '○ 空闲';

      this.dom.relayChip.className = 'm3-chip idle';
      this.dom.relayChip.textContent = '待命';

      this.stopTimer();
      this.updateDeviceView();

      if (this.fluidGrid) {
        this.fluidGrid.setOptions({
          threshold: 0.87,
          speed: 0.20,
          pixelSize: 6.5,
          pixelGap: 2.0
        });
        this.fluidGrid.setThemeState([90 / 255, 175 / 255, 255 / 255], [220 / 255, 240 / 255, 255 / 255]);
      }
    }
  }

  startTimer() {
    this.stopTimer();
    this.dom.heroTimer.style.display = 'inline';
    this.updateTimerText();
    this.timerInterval = setInterval(() => this.updateTimerText(), 1000);
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.dom.heroTimer.style.display = 'none';
  }

  updateTimerText() {
    if (!this.startTime) return;
    const diff = Math.floor((Date.now() - this.startTime) / 1000);
    const h = String(Math.floor(diff / 3600)).padStart(2, '0');
    const m = String(Math.floor((diff % 3600) / 60)).padStart(2, '0');
    const s = String(diff % 60).padStart(2, '0');
    this.dom.heroTimer.textContent = `• ${h}:${m}:${s}`;
  }

  async handleToggleShare() {
    if (this.currentState === 'RUNNING' || this.currentState === 'STARTING') {
      window.renetUI.showToast('正在断开网络共享...');
      await window.renetApi.stopSharing();
    } else {
      if (this.devices.length === 0) {
        window.renetUI.showToast('未检测到手机，请连接数据线并打开【USB 调试】');
        return;
      }

      if (this.selectedSerial === 'all') {
        const hasReady = this.devices.some(d => d.state === 'device');
        if (!hasReady) {
          window.renetUI.showToast('手机尚未授权调试，请在手机屏幕上确认授权');
          return;
        }

        window.renetUI.showToast('正在为全部已连接设备开启网络共享 (AutoRun)...');
        const result = await window.renetApi.startSharing({
          serial: 'all',
          dns: this.config.dns,
          port: this.config.port,
          route: this.config.route
        });
        this.checkStartResult(result);
        return;
      }

      const targetDevice = this.devices.find(d => d.serial === this.selectedSerial) || this.devices.find(d => d.state === 'device');
      if (!targetDevice) {
        window.renetUI.showToast('未找到选中的设备，请重新选择');
        return;
      }

      if (targetDevice.state === 'unauthorized') {
        window.renetUI.showToast(`设备 ${targetDevice.model || targetDevice.serial} 尚未授权调试，请在手机屏幕上确认允许`);
        return;
      }

      window.renetUI.showToast(`正在为 ${targetDevice.model || targetDevice.serial} 开启共享...`);
      const result = await window.renetApi.startSharing({
        serial: targetDevice.serial,
        dns: this.config.dns,
        port: this.config.port,
        route: this.config.route
      });
      this.checkStartResult(result);
    }
  }

  checkStartResult(result) {
    if (!result.success) {
      if (result.portOccupied && result.occupier) {
        const occ = result.occupier;
        window.renetUI.showConfirm({
          title: '⚠️ 端口被外部程序占用',
          message: `端口 ${this.config.port || 31416} 目前正被外部程序占用 (PID: ${occ.pid}, 名称: ${occ.name || '未知'})。\n路径: ${occ.path || '无'}\n\n是否需要手动尝试结束该进程？`,
          onConfirm: async () => {
            const killRes = await window.renetApi.killProcess(occ.pid);
            if (killRes.success) {
              window.renetUI.showToast('进程已结束，请重新点击开启网络共享');
            } else {
              window.renetUI.showToast('结束失败，请手动在任务管理器中排查');
            }
          }
        });
      } else {
        window.renetUI.showToast(`启动失败: ${result.message}`);
      }
    }
  }

  initCustomDeviceDropdown() {
    const btn = this.dom.customDeviceBtn;
    const menu = this.dom.customDeviceMenu;
    const wrapper = this.dom.heroSelectWrapper;

    if (!btn || !menu) return;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.currentState === 'RUNNING' || this.currentState === 'STARTING' || this.currentState === 'STOPPING') return;
      if (this.devices.length === 0) return;
      const isOpen = menu.style.display !== 'none';
      if (isOpen) {
        this.closeCustomDeviceMenu();
      } else {
        this.openCustomDeviceMenu();
      }
    });

    document.addEventListener('click', (e) => {
      if (wrapper && !wrapper.contains(e.target)) {
        this.closeCustomDeviceMenu();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeCustomDeviceMenu();
      }
    });
  }

  openCustomDeviceMenu() {
    if (!this.dom.customDeviceMenu || !this.dom.customDeviceBtn) return;
    this.dom.customDeviceMenu.style.display = 'flex';
    this.dom.customDeviceBtn.classList.add('open');
    this.dom.customDeviceBtn.setAttribute('aria-expanded', 'true');
  }

  closeCustomDeviceMenu() {
    if (!this.dom.customDeviceMenu || !this.dom.customDeviceBtn) return;
    this.dom.customDeviceMenu.style.display = 'none';
    this.dom.customDeviceBtn.classList.remove('open');
    this.dom.customDeviceBtn.setAttribute('aria-expanded', 'false');
  }

  syncCustomDeviceDropdown() {
    const btn = this.dom.customDeviceBtn;
    const textSpan = this.dom.customDeviceText;
    const menu = this.dom.customDeviceMenu;
    const select = this.dom.deviceSelect;

    if (!btn || !textSpan || !menu || !select) return;

    // 1. Update trigger text based on current selection
    const selectedOption = select.options[select.selectedIndex];
    if (selectedOption) {
      textSpan.textContent = selectedOption.textContent;
    } else {
      textSpan.textContent = this.devices.length === 0 ? '等待 Android 设备接入...' : '选择共享设备...';
    }

    // 2. Rebuild menu items safely
    while (menu.firstChild) {
      menu.removeChild(menu.firstChild);
    }

    if (this.devices.length === 0) {
      const emptyItem = document.createElement('div');
      emptyItem.className = 'custom-dropdown-item';
      emptyItem.style.opacity = '0.6';
      emptyItem.style.cursor = 'default';
      emptyItem.textContent = '等待 Android 设备接入...';
      menu.appendChild(emptyItem);
      btn.disabled = true;
      return;
    }

    const isRunning = this.currentState === 'RUNNING' || this.currentState === 'STARTING' || this.currentState === 'STOPPING';
    btn.disabled = isRunning;

    for (let i = 0; i < select.options.length; i++) {
      const opt = select.options[i];
      const item = document.createElement('div');
      item.className = 'custom-dropdown-item';
      item.dataset.value = opt.value;
      item.textContent = opt.textContent;

      if (opt.value === this.selectedSerial) {
        item.classList.add('selected');
      }

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.currentState === 'RUNNING' || this.currentState === 'STARTING') {
          window.renetUI.showToast('共享运行中，停止后可切换目标设备');
          return;
        }
        select.value = opt.value;
        this.handleDeviceSelected(opt.value);
        this.closeCustomDeviceMenu();
      });

      menu.appendChild(item);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.renetApp = new AppController();
});
