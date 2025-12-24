import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods for serial port communication
contextBridge.exposeInMainWorld('electronAPI', {
  serial: {
    listPorts: () => ipcRenderer.invoke('serial:list-ports'),
    openPort: (config: any) => ipcRenderer.invoke('serial:open-port', config),
    closePort: () => ipcRenderer.invoke('serial:close-port'),
    writeData: (data: Buffer) => ipcRenderer.invoke('serial:write-data', data),
    isOpen: () => ipcRenderer.invoke('serial:is-open'),
    onDataReceived: (callback: (data: Buffer) => void) => {
      ipcRenderer.on('serial:data-received', (event, data) => callback(data));
    },
    onError: (callback: (error: string) => void) => {
      ipcRenderer.on('serial:error', (event, error) => callback(error));
    },
    onPortClosed: (callback: () => void) => {
      ipcRenderer.on('serial:port-closed', () => callback());
    },
  },
});
