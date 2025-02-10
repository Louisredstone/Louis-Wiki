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

// interface WikiLibrarySummary{
//     updated_at: number;
//     "duplicated-wiki-tags": {
//         [wiki_tag: string]: string[]
//     };
//     "wiki-tags": {
//         [wiki_tag: string]: string[]
//     };
//     files: {
//         [path: string]: FileInfo
//     }
// }

interface SimilarityInfo{
    fm: TFileWithMetadata;
    similarity: number;
    intersection_size: number;
}

export class WikiLibrary{
    app: App;
    rootFolderPath: string;
    rootFolder: TFolder;
    // summary: WikiLibrarySummary;
    // summaryTFile: TFile;
    folders: TFolder[];
    allNotes: TFileWithMetadata[];
    wikiEntries: TFileWithMetadata[];
    disambiguationNotes: TFileWithMetadata[];
    categories: TFileWithMetadata[];
    otherNotes: TFileWithMetadata[];
    entryTemplate: string;

    wiki_tag_dict: {[wiki_tag: string]: TFileWithMetadata[]};
    duplicated_wiki_tags: string[];

    constructor(app: App, rootFolder: string|null, entryTemplate: string) {
        if (!rootFolder) {
            error("Root folder not specified, please set it in settings.");
            return;
        }
        this.app = app;
        this.rootFolderPath = rootFolder;
        this.entryTemplate = entryTemplate;
        this.init_folders();
        this.init_files();
        this.init_wiki_tags();
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
        const allNotes: TFileWithMetadata[] = [];
        Vault.recurseChildren(this.rootFolder, (tAbstractFile)=>{
            if (tAbstractFile instanceof TFile && tAbstractFile.extension ==='md')
            {
                const metadata = this.app.metadataCache.getFileCache(tAbstractFile);
                allNotes.push({file: tAbstractFile, metadata: metadata});
            }
        });
        const wikiEntries: TFileWithMetadata[] = [];
        const categories: TFileWithMetadata[] = [];
        const disambiguationNotes: TFileWithMetadata[] = [];
        const otherFiles: TFileWithMetadata[] = [];
        for (const file of allNotes) {
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
                wikiEntries.push(file);
            } else if (frontmatter['note-type'] === 'category') {
                categories.push(file);
            } else if (frontmatter['note-type'] === 'disambiguation') {
                disambiguationNotes.push(file);
            } else {
                otherFiles.push(file);
            }
        }
        this.allNotes = allNotes;
        this.wikiEntries = wikiEntries;
        this.categories = categories;
        this.disambiguationNotes = disambiguationNotes;
        this.otherNotes = otherFiles;
    }

    async init_wiki_tags(): Promise<void> {
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

        const wiki_tag_dict: {[wiki_tag: string]: TFileWithMetadata[]} = {};
        wiki_tag_dict[''] = [];
        for (const fm of this.wikiEntries) {
            const metadata = fm.metadata;
            if (!metadata) {
                wiki_tag_dict[''].push(fm);
                continue;
            }
            const frontmatter = metadata.frontmatter;
            if (!frontmatter) {
                wiki_tag_dict[''].push(fm);
                continue;
            }
            const wiki_tag = frontmatter['wiki-tag'];
            if (!wiki_tag) {
                wiki_tag_dict[''].push(fm);
                continue;
            }
            if (wiki_tag in wiki_tag_dict) {
                wiki_tag_dict[wiki_tag].push(fm);
            } else {
                wiki_tag_dict[wiki_tag] = [fm];
            }
        }
        this.wiki_tag_dict = wiki_tag_dict;
        this.duplicated_wiki_tags = Object.keys(this.wiki_tag_dict).filter(tag => tag!="" && this.wiki_tag_dict[tag].length > 1);
    }

    async addNewEntry(folder: string|TFolder, title: string, wiki_tag: string, aliases: string[], tags: string[], description: string, titleItems: string[]): Promise<void> {
        const similarities = await this.similarityAnalyze(wiki_tag, aliases, titleItems);
        if (similarities.length > 0) {
            const most_similar = similarities[0];
            if (most_similar.similarity > 0.5 && most_similar.intersection_size > 1) {
                const yes = await yesNoPrompt(this.app, "A very similar note found, cancellation recommended. Or you may consider creating a disambiguation note. Do you want to cancel?", "title: '"+basename(most_similar.fm.file.path)+"', similarity: "+most_similar.similarity.toFixed(2)+", intersection: "+most_similar.intersection_size);
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
        var sameTitleNote = this.allNotes.filter(note => note.file.name == title)
        if (sameTitleNote.length > 0) {
            console.log("note already exists");
            log("Wiki note with the same title already exists, open it instead.");
            await open_file(this.app, sameTitleNote[0].file);
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
        const cache = this.app.metadataCache.getFileCache(newWikiEntry);
        // TODO: update frontmatter through cache, rather than stringifyYaml

        // # post process wiki entry creation: update wiki summary
        console.log("post process wiki entry creation");
        if (wiki_tag in this.wiki_tag_dict) {
            this.wiki_tag_dict[wiki_tag].push({file: newWikiEntry, metadata: cache});
            this.duplicated_wiki_tags.push(wiki_tag);
        } else {
            this.wiki_tag_dict[wiki_tag] = [{file: newWikiEntry, metadata: cache}];
        }
        // this.summary['files'][newNoteFilePath] = frontmatter;
        // this.summary.updated_at = new Date().getTime();
        // this.app.vault.modify(this.summaryTFile, JSON.stringify(this.summary, null, 2));

        // # open note
        await open_file(this.app, newWikiEntry);

        log("New Wiki Entry '"+title+"' created successfully!", 3);
    }

    async similarityAnalyze(wiki_tag: string, aliases: string[], titleEntities: string[]): Promise<SimilarityInfo[]>{
        var similarities = this.allNotes.map((fm) => {
            const metadata = fm.metadata;
            if (!metadata) return null;
            const frontmatter = metadata.frontmatter;
            if (!frontmatter) return null;
            var setA = new Set(titleEntities);
            var setB = new Set(frontmatter.tags.concat(frontmatter.aliases));
            var intersection = new Set(titleEntities.filter(x => setB.has(x)));
            var similarity = intersection.size / Math.min(setA.size, setB.size);
            if (wiki_tag == frontmatter['wiki-tag']) {
                similarity = Math.max(similarity, 1);
            } else if (frontmatter.tags.concat(frontmatter.aliases).includes(wiki_tag) || aliases.includes(frontmatter['wiki-tag'])){
                similarity = Math.max(similarity, 0.7);
            }
            var intersection_size = intersection.size;
            return {fm, similarity, intersection_size};
        }).filter(item => item!= null);
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

function foundMultipleSimilarNotesPrompt(app: App, similarities: SimilarityInfo[]): Promise<boolean|null> {
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
    similaritiesInfo: SimilarityInfo[];
    continueCallback: () => Promise<void>;
    cancelCallback: () => Promise<void>;

    constructor(app: App, similaritiesInfo: SimilarityInfo[], continueCallback: () => Promise<void> = async () => {}, cancelCallback: () => Promise<void> = async () => {}) {
        super(app);
        this.similaritiesInfo = similaritiesInfo;
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
        for (const { fm, similarity, intersection_size } of this.similaritiesInfo) {
            const row = table.createEl('tr');
            var wiki_tag = '-';
            if (fm.metadata) {
                const frontmatter = fm.metadata.frontmatter;
                if (frontmatter) {
                    wiki_tag = frontmatter['wiki-tag'];
                }
            }
            row.createEl('td', { text: wiki_tag });
            row.createEl('td', { text: similarity.toFixed(2) });
            row.createEl('td', { text: intersection_size.toString() });
            row.createEl('td', { text: fm.file.path });
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