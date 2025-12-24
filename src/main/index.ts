import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { SerialPort } from 'serialport';

let mainWindow: BrowserWindow | null = null;
let currentPort: SerialPort | null = null;

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

  // Open DevTools in development
  mainWindow.webContents.openDevTools();

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
    if (currentPort && currentPort.isOpen) {
      await currentPort.close();
    }

    currentPort = new SerialPort({
      path: config.path,
      baudRate: config.baudRate,
      dataBits: config.dataBits,
      stopBits: config.stopBits,
      parity: config.parity,
      autoOpen: false,
    });

    return new Promise((resolve, reject) => {
      currentPort!.open((err) => {
        if (err) {
          reject(err.message);
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

app.whenReady().then(() => {
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
