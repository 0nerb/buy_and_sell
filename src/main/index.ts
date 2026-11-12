import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { buildConsensus } from '@shared/consensus'
import { buildConsolidated } from '@shared/portfolio'
import type { ProviderId, Report, Settings } from '@shared/types'
import { AIError, createProvider } from './ai'
import { importFiles } from './importer'
import { searchPortfolios } from './search'
import {
  deleteReport,
  getReports,
  getSettings,
  getSettingsView,
  saveReport,
  saveSettings,
  setApiKey
} from './store'

let win: BrowserWindow | null = null

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'Recomendação',
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true
    }
  })

  // Links externos abrem no navegador, não dentro do app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  const progress = (p: unknown) => win?.webContents.send('import:progress', p)

  ipcMain.handle('reports:list', () => getReports())

  ipcMain.handle('reports:pick', async () => {
    const res = await dialog.showOpenDialog(win!, {
      title: 'Selecionar relatórios',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile', 'multiSelections']
    })
    if (res.canceled) return { imported: [], errors: [] }
    return importFiles(res.filePaths, progress)
  })

  ipcMain.handle('reports:import', (_e, paths: string[]) => importFiles(paths, progress))

  ipcMain.handle('reports:reprocess', async (_e, id: string) => {
    const report = getReports().find((r) => r.id === id)
    if (!report) throw new Error('Relatório não encontrado.')
    if (!existsSync(report.filePath)) {
      throw new Error(`O arquivo original não está mais em ${report.filePath}. Importe-o novamente.`)
    }
    return importFiles([report.filePath], progress, true)
  })

  ipcMain.handle('reports:update', (_e, id: string, patch: Pick<Report, 'institution' | 'reportDate'>) => {
    const report = getReports().find((r) => r.id === id)
    if (!report) throw new Error('Relatório não encontrado.')
    saveReport({ ...report, institution: patch.institution, reportDate: patch.reportDate })
  })

  ipcMain.handle('reports:delete', (_e, id: string) => deleteReport(id))

  ipcMain.handle('reports:open', async (_e, id: string) => {
    const report = getReports().find((r) => r.id === id)
    if (report?.sourceUrl?.startsWith('https://') || report?.sourceUrl?.startsWith('http://')) {
      await shell.openExternal(report.sourceUrl)
      return ''
    }
    if (report?.filePath && existsSync(report.filePath)) return shell.openPath(report.filePath)
    return 'Arquivo não encontrado.'
  })

  ipcMain.handle('consensus:get', () => buildConsensus(getReports(), getSettings()))
  ipcMain.handle('portfolio:get', () => buildConsolidated(getReports(), getSettings()))

  let searching = false
  ipcMain.handle('search:run', async (_e, month: string) => {
    if (searching) throw new Error('Já existe uma busca em andamento.')
    searching = true
    try {
      return await searchPortfolios(month, (p) => win?.webContents.send('search:progress', p))
    } catch (err) {
      const message = err instanceof AIError ? err.message : `Falha na busca: ${err instanceof Error ? err.message : err}`
      win?.webContents.send('search:progress', { stage: 'erro', message })
      throw new Error(message)
    } finally {
      searching = false
    }
  })

  ipcMain.handle('models:list', async (_e, provider: ProviderId) => {
    const p = createProvider(provider)
    if (!p) return []
    return p.listModels()
  })

  ipcMain.handle('settings:get', () => getSettingsView())
  ipcMain.handle('settings:save', (_e, patch: Partial<Settings>) => {
    saveSettings(patch)
    return getSettingsView()
  })
  ipcMain.handle('settings:setApiKey', (_e, provider: ProviderId, key: string | null) => {
    setApiKey(provider, key)
    return getSettingsView()
  })
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
