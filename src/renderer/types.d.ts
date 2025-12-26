export interface SerialPortInfo {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  pnpId?: string;
  vendorId?: string;
  productId?: string;
}

export interface SerialPortConfig {
  path: string;
  baudRate: number;
  dataBits: number;
  stopBits: number;
  parity: string;
}

export interface ElectronAPI {
  serial: {
    listPorts: () => Promise<SerialPortInfo[]>;
    openPort: (config: SerialPortConfig) => Promise<{ success: boolean; error?: string }>;
    closePort: () => Promise<{ success: boolean }>;
    writeData: (data: number[]) => Promise<{ success: boolean; error?: string }>;
    isOpen: () => Promise<boolean>;
    onDataReceived: (callback: (data: Buffer) => void) => void;
    onError: (callback: (error: string) => void) => void;
    onPortClosed: (callback: () => void) => void;
  };
  onMenuEvent: (channel: string, callback: (data?: any) => void) => void;
  updateMenuChecked: (menuLabel: string, itemLabel: string, checked: boolean) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
