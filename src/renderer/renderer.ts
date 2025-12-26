// State management
let isConnected = false;
let currentFormat: 'ascii' | 'hex' = 'ascii';
let rxBytes = 0;
let txBytes = 0;
let connectionStartTime = 0;
let uptimeInterval: NodeJS.Timeout | null = null;
let autoscroll = true;
let showTimestamps = false;
let enableLogging = false;
let logLines: string[] = [];
let rxBuffer = ''; // Buffer for incomplete lines

// DOM Elements
const elements = {
  portSelect: document.getElementById('portSelect') as HTMLSelectElement,
  baudRate: document.getElementById('baudRate') as HTMLSelectElement,
  dataBits: document.getElementById('dataBits') as HTMLSelectElement,
  stopBits: document.getElementById('stopBits') as HTMLSelectElement,
  parity: document.getElementById('parity') as HTMLSelectElement,
  connectBtn: document.getElementById('connectBtn') as HTMLButtonElement,
  disconnectBtn: document.getElementById('disconnectBtn') as HTMLButtonElement,
  refreshPorts: document.getElementById('refreshPorts') as HTMLButtonElement,
  terminal: document.getElementById('terminal') as HTMLDivElement,
  dataInput: document.getElementById('dataInput') as HTMLInputElement,
  sendBtn: document.getElementById('sendBtn') as HTMLButtonElement,
  clearTerminal: document.getElementById('clearTerminal') as HTMLButtonElement,
  toggleAutoscroll: document.getElementById('toggleAutoscroll') as HTMLButtonElement,
  statusIndicator: document.getElementById('statusIndicator') as HTMLSpanElement,
  statusText: document.getElementById('statusText') as HTMLSpanElement,
  rxCount: document.getElementById('rxCount') as HTMLSpanElement,
  txCount: document.getElementById('txCount') as HTMLSpanElement,
  showTimestamps: document.getElementById('showTimestamps') as HTMLButtonElement,
  enableLogging: document.getElementById('enableLogging') as HTMLButtonElement,
  uptime: document.getElementById('uptime') as HTMLSpanElement,
  addNewline: document.getElementById('addNewline') as HTMLButtonElement,
  echoLocal: document.getElementById('echoLocal') as HTMLButtonElement,
};

// Initialize the application
async function init() {
  await refreshPorts();
  setupEventListeners();
  setupSerialListeners();
}

// Refresh available serial ports
async function refreshPorts() {
  try {
    const ports = await window.electronAPI.serial.listPorts();
    console.log('Found ports:', ports);
    elements.portSelect.innerHTML = '<option value="">Select a port...</option>';
    
    ports.forEach(port => {
      const option = document.createElement('option');
      option.value = port.path;
      option.textContent = `${port.path}${port.manufacturer ? ' - ' + port.manufacturer : ''}`;
      elements.portSelect.appendChild(option);
    });

    addTerminalLine(`Found ${ports.length} port(s)`, 'info');
  } catch (error) {
    console.error('Error listing ports:', error);
    addTerminalLine(`Error listing ports: ${error}`, 'error');
  }
}

// Setup event listeners
function setupEventListeners() {
  elements.refreshPorts.addEventListener('click', refreshPorts);
  elements.connectBtn.addEventListener('click', connectToPort);
  elements.disconnectBtn.addEventListener('click', disconnectFromPort);
  elements.sendBtn.addEventListener('click', sendData);
  elements.clearTerminal.addEventListener('click', clearTerminal);
  elements.toggleAutoscroll.addEventListener('click', toggleAutoscroll);

  // Timestamp toggle
  elements.showTimestamps.addEventListener('click', () => {
    showTimestamps = !showTimestamps;
    elements.showTimestamps.classList.toggle('active', showTimestamps);
    elements.terminal.classList.toggle('show-timestamps', showTimestamps);
  });

  // Logging toggle
  elements.enableLogging.addEventListener('click', () => {
    enableLogging = !enableLogging;
    elements.enableLogging.classList.toggle('active', enableLogging);
    if (enableLogging) {
      elements.enableLogging.classList.add('recording');
      addTerminalLine('File logging enabled', 'info');
    } else {
      elements.enableLogging.classList.remove('recording');
      if (logLines.length > 0) {
        downloadLog();
      }
    }
  });

  // Format toggle buttons
  document.querySelectorAll('.format-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = e.target as HTMLButtonElement;
      const format = target.dataset.format as 'ascii' | 'hex';
      setFormat(format);
    });
  });

  // Option buttons (CR and Echo)
  elements.addNewline.addEventListener('click', () => {
    const isActive = elements.addNewline.classList.toggle('active');
    window.electronAPI.updateMenuChecked('Settings', 'CR+LF', isActive);
  });

  elements.echoLocal.addEventListener('click', () => {
    const isActive = elements.echoLocal.classList.toggle('active');
    window.electronAPI.updateMenuChecked('Settings', 'Echo Local', isActive);
  });

  // Enter key to send
  elements.dataInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      sendData();
    }
  });
}

// Setup serial port listeners
function setupSerialListeners() {
  window.electronAPI.serial.onDataReceived((data: Buffer) => {
    rxBytes += data.length;
    updateStats();
    displayReceivedData(data);
  });

  window.electronAPI.serial.onError((error: string) => {
    addTerminalLine(`Error: ${error}`, 'error');
  });

  window.electronAPI.serial.onPortClosed(() => {
    handleDisconnect();
    addTerminalLine('Port closed unexpectedly', 'warning');
  });

  // Menu event listeners
  window.electronAPI.onMenuEvent('menu:clear-terminal', () => {
    clearTerminal();
  });

  window.electronAPI.onMenuEvent('menu:toggle-autoscroll', (enabled: boolean) => {
    autoscroll = enabled;
    elements.toggleAutoscroll.classList.toggle('active', enabled);
  });

  window.electronAPI.onMenuEvent('menu:toggle-timestamps', (enabled: boolean) => {
    showTimestamps = enabled;
    elements.showTimestamps.classList.toggle('active', enabled);
    elements.terminal.classList.toggle('show-timestamps', enabled);
  });

  window.electronAPI.onMenuEvent('menu:set-format', (format: 'ascii' | 'hex') => {
    currentFormat = format;
    document.querySelectorAll('.format-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-format') === format);
    });
  });

  window.electronAPI.onMenuEvent('menu:toggle-newline', (enabled: boolean) => {
    elements.addNewline.classList.toggle('active', enabled);
  });

  window.electronAPI.onMenuEvent('menu:toggle-echo', (enabled: boolean) => {
    elements.echoLocal.classList.toggle('active', enabled);
  });

  window.electronAPI.onMenuEvent('menu:toggle-logging', (enabled: boolean) => {
    enableLogging = enabled;
    elements.enableLogging.classList.toggle('active', enabled);
    if (enabled) {
      elements.enableLogging.classList.add('recording');
      addTerminalLine('File logging enabled', 'info');
    } else {
      elements.enableLogging.classList.remove('recording');
      if (logLines.length > 0) {
        downloadLog();
      }
    }
  });
}

// Connect to serial port
async function connectToPort() {
  const portPath = elements.portSelect.value;
  if (!portPath) {
    addTerminalLine('Please select a port', 'error');
    return;
  }

  const config = {
    path: portPath,
    baudRate: parseInt(elements.baudRate.value),
    dataBits: parseInt(elements.dataBits.value),
    stopBits: parseInt(elements.stopBits.value),
    parity: elements.parity.value,
  };

  try {
    const result = await window.electronAPI.serial.openPort(config);
    if (result.success) {
      handleConnect();
      addTerminalLine(`Connected to ${portPath} at ${config.baudRate} baud`, 'success');
    } else {
      addTerminalLine(`Connection failed: ${result.error}`, 'error');
    }
  } catch (error) {
    addTerminalLine(`Error: ${error}`, 'error');
  }
}

// Disconnect from serial port
async function disconnectFromPort() {
  try {
    await window.electronAPI.serial.closePort();
    handleDisconnect();
    addTerminalLine('Disconnected', 'info');
  } catch (error) {
    addTerminalLine(`Error disconnecting: ${error}`, 'error');
  }
}

// Handle connection state
function handleConnect() {
  isConnected = true;
  connectionStartTime = Date.now();
  rxBytes = 0;
  txBytes = 0;
  updateStats();
  
  elements.connectBtn.disabled = true;
  elements.disconnectBtn.disabled = false;
  elements.dataInput.disabled = false;
  elements.sendBtn.disabled = false;
  elements.portSelect.disabled = true;
  elements.baudRate.disabled = true;
  elements.dataBits.disabled = true;
  elements.stopBits.disabled = true;
  elements.parity.disabled = true;
  
  elements.statusIndicator.className = 'status-indicator connected';
  elements.statusText.textContent = 'Connected';

  uptimeInterval = setInterval(updateUptime, 1000);
}

// Handle disconnection state
function handleDisconnect() {
  isConnected = false;
  rxBuffer = ''; // Clear the receive buffer
  
  elements.connectBtn.disabled = false;
  elements.disconnectBtn.disabled = true;
  elements.dataInput.disabled = true;
  elements.sendBtn.disabled = true;
  elements.portSelect.disabled = false;
  elements.baudRate.disabled = false;
  elements.dataBits.disabled = false;
  elements.stopBits.disabled = false;
  elements.parity.disabled = false;
  
  elements.statusIndicator.className = 'status-indicator';
  elements.statusText.textContent = 'Disconnected';

  if (uptimeInterval) {
    clearInterval(uptimeInterval);
    uptimeInterval = null;
  }
}

// Send data to serial port
async function sendData() {
  const input = elements.dataInput.value;
  if (!input) return;

  let dataArray: number[];

  if (currentFormat === 'hex') {
    // Parse hex string
    const hexString = input.replace(/[^0-9a-fA-F]/g, '');
    if (hexString.length % 2 !== 0) {
      addTerminalLine('Invalid hex string (must be even length)', 'error');
      return;
    }
    dataArray = [];
    for (let i = 0; i < hexString.length; i += 2) {
      dataArray.push(parseInt(hexString.substr(i, 2), 16));
    }
  } else {
    // ASCII mode
    let textToSend = input;
    if (elements.addNewline.classList.contains('active')) {
      textToSend += '\r\n';
    }
    // Convert string to byte array
    dataArray = Array.from(textToSend).map(c => c.charCodeAt(0));
  }

  try {
    const result = await window.electronAPI.serial.writeData(dataArray);
    if (result.success) {
      txBytes += dataArray.length;
      updateStats();
      
      if (elements.echoLocal.classList.contains('active')) {
        addTerminalLine(input, 'tx');
      }
      
      elements.dataInput.value = '';;
    } else {
      addTerminalLine(`Send failed: ${result.error}`, 'error');
    }
  } catch (error) {
    addTerminalLine(`Error sending: ${error}`, 'error');
  }
}

// Display received data
function displayReceivedData(data: any) {
  // Data comes as {type: 'Buffer', data: [bytes]} from IPC
  let bytes: number[];
  if (data && data.type === 'Buffer' && Array.isArray(data.data)) {
    bytes = data.data;
  } else if (Array.isArray(data)) {
    bytes = data;
  } else if (data instanceof Uint8Array) {
    bytes = Array.from(data);
  } else {
    bytes = [];
  }

  if (currentFormat === 'hex') {
    const hexString = bytes
      .map(b => b.toString(16).padStart(2, '0').toUpperCase())
      .join(' ');
    addTerminalLine(hexString, 'rx');
  } else {
    // Convert bytes to ASCII string
    const text = String.fromCharCode(...bytes);
    
    // Add to buffer and process complete lines
    rxBuffer += text;
    
    // Split by newlines (handle \r\n, \n, \r)
    const lines = rxBuffer.split(/\r?\n|\r/);
    
    // Keep the last incomplete line in buffer
    rxBuffer = lines.pop() || '';
    
    // Display complete lines
    for (const line of lines) {
      if (line.length > 0) {
        addTerminalLine(line, 'rx');
      }
    }
  }
}

// Add line to terminal
function addTerminalLine(text: string, type: 'info' | 'error' | 'success' | 'warning' | 'tx' | 'rx' = 'info', newLine = true) {
  const line = document.createElement('div');
  line.className = `terminal-line ${type}`;
  
  const timestamp = document.createElement('span');
  timestamp.className = 'timestamp';
  const now = new Date();
  timestamp.textContent = now.toLocaleTimeString('en-US', { hour12: false });
  
  const content = document.createElement('span');
  content.className = 'content';
  content.textContent = text;
  
  if (type === 'tx') {
    const arrow = document.createElement('span');
    arrow.className = 'arrow tx-arrow';
    arrow.textContent = '→ ';
    line.appendChild(timestamp);
    line.appendChild(arrow);
    line.appendChild(content);
  } else if (type === 'rx') {
    const arrow = document.createElement('span');
    arrow.className = 'arrow rx-arrow';
    arrow.textContent = '← ';
    line.appendChild(timestamp);
    line.appendChild(arrow);
    line.appendChild(content);
  } else {
    line.appendChild(timestamp);
    line.appendChild(content);
  }
  
  elements.terminal.appendChild(line);
  
  // Add to log if logging is enabled
  if (enableLogging && (type === 'tx' || type === 'rx')) {
    const logEntry = `${timestamp.textContent} ${type === 'tx' ? '→' : '←'} ${text}`;
    logLines.push(logEntry);
  }
  
  if (autoscroll) {
    elements.terminal.scrollTop = elements.terminal.scrollHeight;
  }
}

// Clear terminal
function clearTerminal() {
  elements.terminal.innerHTML = '';
  addTerminalLine('Terminal cleared', 'info');
}

// Toggle autoscroll
function toggleAutoscroll() {
  autoscroll = !autoscroll;
  elements.toggleAutoscroll.style.opacity = autoscroll ? '1' : '0.5';
  addTerminalLine(`Autoscroll ${autoscroll ? 'enabled' : 'disabled'}`, 'info');
}

// Set data format
function setFormat(format: 'ascii' | 'hex') {
  currentFormat = format;
  document.querySelectorAll('.format-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-format') === format);
  });
  
  elements.dataInput.placeholder = format === 'hex' 
    ? 'Enter hex bytes (e.g., 48 65 6C 6C 6F)...' 
    : 'Enter data to send...';
}

// Update statistics
function updateStats() {
  elements.rxCount.textContent = formatBytes(rxBytes);
  elements.txCount.textContent = formatBytes(txBytes);
}

// Download log file
function downloadLog() {
  if (logLines.length === 0) return;
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
  const filename = `serial-log-${timestamp}.txt`;
  const content = logLines.join('\n');
  
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  
  addTerminalLine(`Log saved to ${filename}`, 'success');
  logLines = [];
}

// Update uptime
function updateUptime() {
  if (!isConnected) return;
  
  const elapsed = Math.floor((Date.now() - connectionStartTime) / 1000);
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;
  
  elements.uptime.textContent = 
    `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// Format bytes for display
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 bytes';
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// Initialize on load
init();
