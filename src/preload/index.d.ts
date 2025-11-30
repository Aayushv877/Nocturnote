import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      saveFile: (
        content: string,
        filePath: string | null
      ) => Promise<{ success: boolean; filePath?: string; error?: string }>
      openFile: () => Promise<{
        canceled: boolean
        filePath?: string
        content?: string
        error?: string
      }>
      minimize: () => void
      maximize: () => void
      close: () => void
      platform: NodeJS.Platform
      getInitialFile: () => Promise<{ content: string; filePath: string } | null>
      getAppVersion: () => Promise<string>
      onFileOpened: (callback: (content: string, filePath: string) => void) => void
    }
  }
}
