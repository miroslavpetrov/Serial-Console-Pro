import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import * as path from 'path';
import { SerialPort } from 'serialport';

let mainWindow: BrowserWindow | null = null;
let currentPort: SerialPort | null = null;

type SerialParity = 'none' | 'even' | 'odd' | 'mark' | 'space';

interface SerialPortConfig {
  path: string;
  baudRate: number;
  dataBits: 5 | 6 | 7 | 8;
  stopBits: 1 | 2;
  parity: SerialParity;
}

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsedValue = Number(value.trim());
    return Number.isSafeInteger(parsedValue) && parsedValue > 0 ? parsedValue : null;
  }

  return null;
}

function validateSerialPortConfig(config: unknown): { success: true; config: SerialPortConfig } | { success: false; error: string } {
  if (!config || typeof config !== 'object') {
    return { success: false, error: 'Invalid serial port configuration' };
  }

  const candidate = config as Record<string, unknown>;
  const path = typeof candidate.path === 'string' ? candidate.path.trim() : '';
  const baudRate = parsePositiveInteger(candidate.baudRate);
  const dataBits = parsePositiveInteger(candidate.dataBits);
  const stopBits = parsePositiveInteger(candidate.stopBits);
  const parity = candidate.parity;

  if (!path) {
    return { success: false, error: 'A serial port path is required' };
  }

  if (baudRate === null) {
    return { success: false, error: 'Baud rate must be a positive whole number' };
  }

  if (dataBits !== 5 && dataBits !== 6 && dataBits !== 7 && dataBits !== 8) {
    return { success: false, error: 'Data bits must be 5, 6, 7, or 8' };
  }

  if (stopBits !== 1 && stopBits !== 2) {
    return { success: false, error: 'Stop bits must be 1 or 2' };
  }

  if (parity !== 'none' && parity !== 'even' && parity !== 'odd' && parity !== 'mark' && parity !== 'space') {
    return { success: false, error: 'Parity setting is invalid' };
  }

  return {
    success: true,
    config: {
      path,
      baudRate,
      dataBits,
      stopBits,
      parity,
    },
  };
}

function createMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Clear Terminal',
          accelerator: 'CmdOrCtrl+K',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('menu:clear-terminal');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Autoscroll',
          type: 'checkbox',
          checked: true,
          click: (menuItem) => {
            if (mainWindow) {
              mainWindow.webContents.send('menu:toggle-autoscroll', menuItem.checked);
            }
          }
        },
        {
          label: 'Show Timestamps',
          type: 'checkbox',
          checked: false,
          click: (menuItem) => {
            if (mainWindow) {
              mainWindow.webContents.send('menu:toggle-timestamps', menuItem.checked);
            }
          }
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' }
      ]
    },
    {
      label: 'Settings',
      submenu: [
        {
          label: 'Format',
          submenu: [
            {
              label: 'ASCII',
              type: 'radio',
              checked: true,
              click: () => {
                if (mainWindow) {
                  mainWindow.webContents.send('menu:set-format', 'ascii');
                }
              }
            },
            {
              label: 'Hex',
              type: 'radio',
              checked: false,
              click: () => {
                if (mainWindow) {
                  mainWindow.webContents.send('menu:set-format', 'hex');
                }
              }
            }
          ]
        },
        { type: 'separator' },
        {
          label: 'CR+LF',
          type: 'checkbox',
          checked: true,
          click: (menuItem) => {
            if (mainWindow) {
              mainWindow.webContents.send('menu:toggle-newline', menuItem.checked);
            }
          }
        },
        {
          label: 'Echo Local',
          type: 'checkbox',
          checked: false,
          click: (menuItem) => {
            if (mainWindow) {
              mainWindow.webContents.send('menu:toggle-echo', menuItem.checked);
            }
          }
        },
        {
          label: 'Enable Logging',
          type: 'checkbox',
          checked: false,
          click: (menuItem) => {
            if (mainWindow) {
              mainWindow.webContents.send('menu:toggle-logging', menuItem.checked);
            }
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1a2e',
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.on('closed', () => {
    if (currentPort && currentPort.isOpen) {
      currentPort.close();
    }
    mainWindow = null;
  });
}

// IPC Handlers for serial port operations
ipcMain.handle('serial:list-ports', async () => {
  try {
    console.log('Listing serial ports...');
    const ports = await SerialPort.list();
    console.log('Found ports:', ports);
    return ports.map(port => ({
      path: port.path,
      manufacturer: port.manufacturer || 'Unknown',
      serialNumber: port.serialNumber,
      pnpId: port.pnpId,
      vendorId: port.vendorId,
      productId: port.productId,
    }));
  } catch (error) {
    console.error('Error listing ports:', error);
    return [];
  }
});

ipcMain.handle('serial:open-port', async (event, config) => {
  try {
    const validation = validateSerialPortConfig(config);
    if (!validation.success) {
      return { success: false, error: validation.error };
    }

    const serialConfig = validation.config;

    if (currentPort && currentPort.isOpen) {
      await currentPort.close();
    }

    currentPort = new SerialPort({
      path: serialConfig.path,
      baudRate: serialConfig.baudRate,
      dataBits: serialConfig.dataBits,
      stopBits: serialConfig.stopBits,
      parity: serialConfig.parity,
      autoOpen: false,
    });

    return new Promise((resolve, reject) => {
      currentPort!.open((err) => {
        if (err) {
          reject(new Error(err.message));
          return;
        }

        currentPort!.on('data', (data) => {
          if (mainWindow) {
            mainWindow.webContents.send('serial:data-received', data);
          }
        });

        currentPort!.on('error', (err) => {
          if (mainWindow) {
            mainWindow.webContents.send('serial:error', err.message);
          }
        });

        currentPort!.on('close', () => {
          if (mainWindow) {
            mainWindow.webContents.send('serial:port-closed');
          }
        });

        resolve({ success: true });
      });
    });
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('serial:close-port', async () => {
  if (currentPort && currentPort.isOpen) {
    return new Promise((resolve) => {
      currentPort!.close(() => {
        currentPort = null;
        resolve({ success: true });
      });
    });
  }
  return { success: true };
});

ipcMain.handle('serial:write-data', async (event, data) => {
  if (!currentPort || !currentPort.isOpen) {
    return { success: false, error: 'Port not open' };
  }

  return new Promise((resolve) => {
    currentPort!.write(data, (err) => {
      if (err) {
        resolve({ success: false, error: err.message });
      } else {
        resolve({ success: true });
      }
    });
  });
});

ipcMain.handle('serial:is-open', async () => {
  return currentPort ? currentPort.isOpen : false;
});

ipcMain.on('menu:update-checked', (event, menuLabel, itemLabel, checked) => {
  const menu = Menu.getApplicationMenu();
  if (!menu) return;

  const menuItem = menu.items.find(item => item.label === menuLabel);
  if (!menuItem || !menuItem.submenu) return;

  const subItem = menuItem.submenu.items.find(item => item.label === itemLabel);
  if (subItem) {
    subItem.checked = checked;
  }
});

app.whenReady().then(() => {
  createMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (currentPort && currentPort.isOpen) {
    currentPort.close();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
