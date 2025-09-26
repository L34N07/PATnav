export interface ElectronAPI {}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
export {}
