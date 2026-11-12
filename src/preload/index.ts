import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  ConsolidatedPortfolio,
  Consensus,
  ImportProgress,
  ImportResult,
  ProviderId,
  Report,
  SearchProgress,
  SearchResult,
  Settings,
  SettingsView
} from '@shared/types'

const api = {
  listReports: (): Promise<Report[]> => ipcRenderer.invoke('reports:list'),
  pickAndImport: (): Promise<ImportResult> => ipcRenderer.invoke('reports:pick'),
  importFiles: (files: File[]): Promise<ImportResult> =>
    ipcRenderer.invoke('reports:import', files.map((f) => webUtils.getPathForFile(f))),
  reprocessReport: (id: string): Promise<ImportResult> => ipcRenderer.invoke('reports:reprocess', id),
  updateReport: (id: string, patch: Pick<Report, 'institution' | 'reportDate'>): Promise<void> =>
    ipcRenderer.invoke('reports:update', id, patch),
  deleteReport: (id: string): Promise<void> => ipcRenderer.invoke('reports:delete', id),
  openReport: (id: string): Promise<string> => ipcRenderer.invoke('reports:open', id),
  getConsensus: (): Promise<Consensus[]> => ipcRenderer.invoke('consensus:get'),
  getPortfolio: (): Promise<ConsolidatedPortfolio> => ipcRenderer.invoke('portfolio:get'),
  searchPortfolios: (month: string): Promise<SearchResult> => ipcRenderer.invoke('search:run', month),
  listModels: (provider: ProviderId): Promise<string[]> => ipcRenderer.invoke('models:list', provider),
  getSettings: (): Promise<SettingsView> => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch: Partial<Settings>): Promise<SettingsView> => ipcRenderer.invoke('settings:save', patch),
  setApiKey: (provider: ProviderId, key: string | null): Promise<SettingsView> =>
    ipcRenderer.invoke('settings:setApiKey', provider, key),
  onImportProgress: (cb: (p: ImportProgress) => void): (() => void) => {
    const listener = (_: unknown, p: ImportProgress) => cb(p)
    ipcRenderer.on('import:progress', listener)
    return () => ipcRenderer.removeListener('import:progress', listener)
  },
  onSearchProgress: (cb: (p: SearchProgress) => void): (() => void) => {
    const listener = (_: unknown, p: SearchProgress) => cb(p)
    ipcRenderer.on('search:progress', listener)
    return () => ipcRenderer.removeListener('search:progress', listener)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
