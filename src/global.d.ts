export interface ElectronAPI {
  runPython: (cmd: string, params?: any[]) => Promise<string>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
export {}
