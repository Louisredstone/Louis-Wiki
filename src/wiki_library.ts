// add new wiki entry
// update wiki library

import { App, Vault, TFolder, TFile } from 'obsidian';
import {log, error} from './utils'

export class WikiLibrary{
    app: App;
    rootFolder: string;
    summary: any;
    folders: TFolder[];

    constructor(app: App, rootFolder: string) {
        this.app = app;
        this.rootFolder = rootFolder;
        this.init_folders();
        this.init_wiki_summary();
    }

    async init_folders(): Promise<void> {
        const tFolder = this.app.vault.getFolderByPath(this.rootFolder);
        if (!tFolder) {
            console.log("wiki folder not found, creating one...")
            const newRoot = await this.app.vault.createFolder(this.rootFolder);
            this.folders = [newRoot];
        }
        var folders: TFolder[] = [];
        Vault.recurseChildren(tFolder!, (tAbstractFile)=>{
            if (tAbstractFile instanceof TFolder)
                folders.push(tAbstractFile);
        });
        this.folders = folders;
    }

    async init_wiki_summary(): Promise<void> {
        const summaryPath = this.rootFolder + '/wiki-summary.json';
        const summaryTFile = this.app.vault.getFileByPath(summaryPath);
        if (!summaryTFile) {
            console.error("wiki summary file not found");
            log("ERROR: wiki summary file not found. Please run 'Update Wiki' command first.");
            return;
        }
        this.summary = JSON.parse(await this.app.vault.read(summaryTFile));
    }

    async addNewEntry(folder: string|TFolder, title: string, aliases: string[], tags: string[]): Promise<void> {
        if (typeof folder ==='string'){
            folder = this.app.vault.getFolderByPath(folder)!;
        }
    }
}