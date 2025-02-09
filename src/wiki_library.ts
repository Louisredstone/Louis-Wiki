// add new wiki entry
// update wiki library

import { App, Vault, TFolder, TFile, Modal, ButtonComponent, stringifyYaml, CachedMetadata } from 'obsidian';
import {log, error, basename, open_file, open_file_by_path, get_sub_folders} from './utils';
import { yesNoPrompt } from './gui/yesNoPrompt';
import { suggester } from './gui/suggester';

interface FileInfo{
    "note-type": string;
    date: string;
    time: string;
    aliases: string[];
    tags: string[];
    "wiki-tag": string;
    description: string;
}

interface TFileWithMetadata{
    file: TFile;
    metadata: CachedMetadata|null;
}

interface WikiLibrarySummary{
    updated_at: number;
    "duplicated-wiki-tags": {
        [wiki_tag: string]: string[]
    };
    "wiki-tags": {
        [wiki_tag: string]: string[]
    };
    files: {
        [path: string]: FileInfo
    }
}


export class WikiLibrary{
    app: App;
    rootFolderPath: string;
    rootFolder: TFolder;
    summary: WikiLibrarySummary;
    // summaryTFile: TFile;
    folders: TFolder[];
    entries: TFileWithMetadata[];
    categories: TFileWithMetadata[];
    otherNotes: TFileWithMetadata[];
    entryTemplate: string;

    constructor(app: App, rootFolder: string, entryTemplate: string) {
        this.app = app;
        this.rootFolderPath = rootFolder;
        this.entryTemplate = entryTemplate;
        this.init_folders();
        this.init_files();
        this.init_wiki_summary();
    }

    async init_folders(): Promise<void> {
        var folders: TFolder[] = [];
        const tFolder = this.app.vault.getFolderByPath(this.rootFolderPath);
        if (!tFolder) {
            console.log("wiki folder not found, creating one...")
            const newRoot = await this.app.vault.createFolder(this.rootFolderPath);
            this.rootFolder = newRoot;
            folders = [newRoot];
        }
        else{
            this.rootFolder = tFolder!;
            
            Vault.recurseChildren(tFolder!, (tAbstractFile)=>{
                if (tAbstractFile instanceof TFolder)
                    folders.push(tAbstractFile);
            });
        }
        this.folders = folders;
    }

    async init_files(): Promise<void> {
        const files: TFileWithMetadata[] = [];
        Vault.recurseChildren(this.rootFolder, (tAbstractFile)=>{
            if (tAbstractFile instanceof TFile && tAbstractFile.extension ==='md')
            {
                const metadata = this.app.metadataCache.getFileCache(tAbstractFile);
                files.push({file: tAbstractFile, metadata: metadata});
            }
        });
        const entries: TFileWithMetadata[] = [];
        const categories: TFileWithMetadata[] = [];
        const otherFiles: TFileWithMetadata[] = [];
        for (const file of files) {
            const metadata = file.metadata;
            if (!metadata) {
                otherFiles.push(file);
                continue;
            }
            const frontmatter = metadata.frontmatter;
            if (!frontmatter) {
                otherFiles.push(file);
                continue;
            }
            if (frontmatter['note-type'] === 'wiki') {
                entries.push(file);
            } else if (frontmatter['note-type'] === 'category') {
                categories.push(file);
            } else {
                otherFiles.push(file);
            }
        }
        this.entries = entries;
        this.categories = categories;
        this.otherNotes = otherFiles;
    }

    async init_wiki_summary(): Promise<void> {
        // const summaryPath = this.rootFolderPath + '/wiki-summary.json';
        // const summaryTFile = this.app.vault.getFileByPath(summaryPath);
        // if (!summaryTFile) {
        //     console.error("wiki summary file not found");
        //     log("ERROR: wiki summary file not found. Please run 'Update Wiki' command first.");
        //     return;
        // }
        // this.summary = JSON.parse(await this.app.vault.read(summaryTFile));
        // this.summaryTFile = summaryTFile;
        // TODO: load summary by analyzing this.entries and this.categories
    }

    async addNewEntry(folder: string|TFolder, title: string, wiki_tag: string, aliases: string[], tags: string[], description: string, titleItems: string[]): Promise<void> {
        const similarities = await this.similarityAnalyze(wiki_tag, aliases, titleItems);
        if (similarities.length > 0) {
            const most_similar = similarities[0];
            if (most_similar.similarity > 0.5 && most_similar.intersection_size > 1) {
                const yes = await yesNoPrompt(this.app, "A very similar note found, cancellation recommended. Or you may consider creating a disambiguation note. Do you want to cancel?", "title: '"+basename(most_similar.path)+"', similarity: "+most_similar.similarity.toFixed(2)+", intersection: "+most_similar.intersection_size);
                // TODO: add disambiguation note
                if (yes) {
                    console.log("very similar note found, canceled creating a new note");
                    log("Similar note found, canceled creating.", 5);
                    return;
                } else if (yes===false){
                    console.log("very similar note found, but create a new note anyway");
                    // TODO: add disambiguation note
                }
                else{ // yes==null or yes==undefined
                    console.log("Operation canceled by user.");
                    log("Operation canceled by user.", 5);
                    return;
                }
            }
        }
        if (similarities.length > 1) {
            const result = await foundMultipleSimilarNotesPrompt(this.app, similarities);
            if (result == null || result == false) {
                console.log("Operation canceled by user.");
                log("Operation canceled by user.", 5);
                return;
            }
        }
        if (typeof folder ==='string'){
            folder = this.app.vault.getFolderByPath(folder)!;
        }

        // # check if note already exists
        var sameTitleNotePaths = Object.keys(this.summary.files).filter((path) => {basename(path)==title});
        if (sameTitleNotePaths.length > 0) {
            console.log("note already exists");
            log("Wiki note with the same title already exists, open it instead.");
            await open_file_by_path(this.app, sameTitleNotePaths[0]);
            return;
        }

        // # create new note
        const frontmatter = {
            "note-type": "wiki",
            date: new Date().toLocaleDateString(),
            time: new Date().toLocaleTimeString(),
            aliases: ['#'+wiki_tag].concat(aliases),
            tags: [wiki_tag].concat(tags).map(tag => '#'+tag),
            "wiki-tag": wiki_tag,
            description: description        
        };

        var content = '---\n' + stringifyYaml(frontmatter) + '---\n' + this.entryTemplate.replace('{{title}}', title);

        const newNoteFilePath = folder.path+'/'+title+'.md'
        const newWikiEntry = await this.app.vault.create(newNoteFilePath, content);

        // # post process wiki entry creation: update wiki summary
        console.log("post process wiki entry creation");
        if (wiki_tag in this.summary['wiki-tags']) {
            this.summary['duplicated-wiki-tags'][wiki_tag] = this.summary['wiki-tags'][wiki_tag].concat([newNoteFilePath]);
            delete this.summary['wiki-tags'][wiki_tag];
        } else {
            this.summary['wiki-tags'][wiki_tag] = [newNoteFilePath];
        }
        this.summary['files'][newNoteFilePath] = frontmatter;
        this.summary.updated_at = new Date().getTime();
        // this.app.vault.modify(this.summaryTFile, JSON.stringify(this.summary, null, 2));

        // # open note
        await open_file(this.app, newWikiEntry);

        log("New Wiki Entry '"+title+"' created successfully!", 3);
    }

    async similarityAnalyze(wiki_tag: string, aliases: string[], titleEntities: string[]): Promise<{path: string, fileInfo: FileInfo, similarity: number, intersection_size: number}[]>{
        var similarities = Object.entries(this.summary.files).map(([path, fileInfo]) => {
            var setA = new Set(titleEntities);
            var setB = new Set(fileInfo.tags.concat(fileInfo.aliases));
            var intersection = new Set(titleEntities.filter(x => setB.has(x)));
            var similarity = intersection.size / Math.min(setA.size, setB.size);
            if (wiki_tag == fileInfo['wiki-tag']) {
                similarity = Math.max(similarity, 1);
            } else if (fileInfo.tags.concat(fileInfo.aliases).includes(wiki_tag) || aliases.includes(fileInfo['wiki-tag'])){
                similarity = Math.max(similarity, 0.7);
            }
            var intersection_size = intersection.size;
            return {path, fileInfo, similarity, intersection_size};
        });
        console.log("DEBUG insert 0");
        similarities = similarities.sort((a, b) => b.similarity - a.similarity).filter(item => item.similarity > 0.5 || item.intersection_size> 1);
        return similarities;
    }

    async refreshTagInheritances(): Promise<void>{
        // TODO
    }

    async refresh(){
        // TODO
    }
}

function foundMultipleSimilarNotesPrompt(app: App, similarities: {path: string, fileInfo: FileInfo, similarity: number, intersection_size: number}[]): Promise<boolean|null> {
    var choice: boolean|null = null;
    const modal = new FoundMultipleSimilarNotesModal(app, similarities, async () => {
        choice = true;
    }, async () => {
        choice = false;
    });
    return new Promise(resolve => {
        modal.open();
        setTimeout(() => {
            resolve(choice);
        }, 10000);
    });
}

class FoundMultipleSimilarNotesModal extends Modal {
    similarities: {path: string, fileInfo: FileInfo, similarity: number, intersection_size: number}[];
    continueCallback: () => Promise<void>;
    cancelCallback: () => Promise<void>;

    constructor(app: App, similarities: {path: string, fileInfo: FileInfo, similarity: number, intersection_size: number}[], continueCallback: () => Promise<void> = async () => {}, cancelCallback: () => Promise<void> = async () => {}) {
        super(app);
        this.similarities = similarities;
        this.continueCallback = continueCallback;
        this.cancelCallback = cancelCallback;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: "Multiple similar notes found" });
        const table = contentEl.createEl('table');
        const headerRow = table.createEl('tr');
        headerRow.createEl('th', { text: "Title" });
        headerRow.createEl('th', { text: "Similarity" });
        headerRow.createEl('th', { text: "Intersection" });
        headerRow.createEl('th', { text: "Path" });
        for (const { path, fileInfo, similarity, intersection_size } of this.similarities) {
            const row = table.createEl('tr');
            row.createEl('td', { text: fileInfo['wiki-tag'] });
            row.createEl('td', { text: similarity.toFixed(2) });
            row.createEl('td', { text: intersection_size.toString() });
            row.createEl('td', { text: path });
        }
        const buttonRow = contentEl.createDiv();
        const continueButton = new ButtonComponent(buttonRow);
        continueButton.setButtonText("Continue");
        continueButton.onClick(async () => {
            this.close();
            await this.continueCallback();
        });
        const cancelButton = new ButtonComponent(buttonRow);
        cancelButton.setButtonText("Cancel");
        cancelButton.onClick(async () => {
            this.close();
            await this.cancelCallback();
        });
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}