export interface ElectronAPI {
  runPython: () => Promise<string>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
export {}