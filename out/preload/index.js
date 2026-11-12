let electron = require("electron");
// src/preload/index.ts
electron.contextBridge.exposeInMainWorld("api", {
	listReports: () => electron.ipcRenderer.invoke("reports:list"),
	pickAndImport: () => electron.ipcRenderer.invoke("reports:pick"),
	importFiles: (files) => electron.ipcRenderer.invoke("reports:import", files.map((f) => electron.webUtils.getPathForFile(f))),
	reprocessReport: (id) => electron.ipcRenderer.invoke("reports:reprocess", id),
	updateReport: (id, patch) => electron.ipcRenderer.invoke("reports:update", id, patch),
	deleteReport: (id) => electron.ipcRenderer.invoke("reports:delete", id),
	openReport: (id) => electron.ipcRenderer.invoke("reports:open", id),
	getConsensus: () => electron.ipcRenderer.invoke("consensus:get"),
	getPortfolio: () => electron.ipcRenderer.invoke("portfolio:get"),
	searchPortfolios: (month) => electron.ipcRenderer.invoke("search:run", month),
	listModels: (provider) => electron.ipcRenderer.invoke("models:list", provider),
	getSettings: () => electron.ipcRenderer.invoke("settings:get"),
	saveSettings: (patch) => electron.ipcRenderer.invoke("settings:save", patch),
	setApiKey: (provider, key) => electron.ipcRenderer.invoke("settings:setApiKey", provider, key),
	onImportProgress: (cb) => {
		const listener = (_, p) => cb(p);
		electron.ipcRenderer.on("import:progress", listener);
		return () => electron.ipcRenderer.removeListener("import:progress", listener);
	},
	onSearchProgress: (cb) => {
		const listener = (_, p) => cb(p);
		electron.ipcRenderer.on("search:progress", listener);
		return () => electron.ipcRenderer.removeListener("search:progress", listener);
	}
});
