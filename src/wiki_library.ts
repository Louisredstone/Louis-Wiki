// add new wiki entry
// update wiki library

import { App, Vault, Notice, TFolder, TFile, Modal, ButtonComponent, stringifyYaml, CachedMetadata } from 'obsidian';
import {log, error, basename, open_file, open_file_by_path, get_sub_folders} from './utils';
import { yesNoPrompt } from './gui/yesNoPrompt';
import { suggester } from './gui/suggester';

interface Node{
    file: TFile;
    metadata: CachedMetadata|null;
    parents: Node[];
    children: Node[];
    scc: SCC|null;
    wiki_tag: string;
}

interface SCC{ // Strongly Connected Component
    nodes: Node[];
    parents: SCC[];
    children: SCC[];
    pseudo_wiki_tag: string;
}

interface SimilarityInfo{
    fm: Node;
    similarity: number;
    intersection_size: number;
}

export class WikiLibrary{
    app: App;
    rootFolderPath: string;
    rootFolder: TFolder;
    folders: TFolder[] = [];
    nodes: {[wiki_tag: string]: Node} = {};
    wikiEntries: Node[] = [];
    disambiguationNotes: Node[] = [];
    categories: Node[] = [];
    otherTypeNotes: Node[]  = [];
    notesWithoutMetadata: TFile[] = [];
    notesWithoutFrontmatter: TFile[] = [];
    notesWithoutWikiTag: TFile[] = [];
    duplicated: {[wiki_tag: string]: Node[]};
    SCCs: {[wiki_tag: string]: SCC} = {};
    entryTemplate: string;

    wiki_tag_dict: {[wiki_tag: string]: Node[]};
    duplicated_wiki_tags: string[];

    constructor(app: App, rootFolder: string|null, entryTemplate: string) {
        log("Initializing wiki library...");
        if (!rootFolder) {
            error("Root folder not specified, please set it in settings.");
            return;
        }
        this.app = app;
        this.rootFolderPath = rootFolder;
        this.entryTemplate = entryTemplate;
        this.SCCs = {};
        this.init_folders();
        this.init_graph();
        this.apply_tag_inheritance();
        this.report_if_necessary();
        log("Wiki library initialized successfully.");
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

    async init_graph(): Promise<void> {
        const nodes: {[wiki_tag: string]: Node} = {};
        const notesWithoutMetadata: TFile[] = [];
        const notesWithoutFrontmatter: TFile[] = [];
        const notesWithoutWikiTag: TFile[] = [];
        const duplicated: {[wiki_tag: string]: Node[]} = {};
        // Initialize nodes.
        Vault.recurseChildren(this.rootFolder, (tAbstractFile)=>{
            if (tAbstractFile instanceof TFile && tAbstractFile.extension ==='md')
            {
                const metadata = this.app.metadataCache.getFileCache(tAbstractFile);
                if (!metadata) {
                    notesWithoutMetadata.push(tAbstractFile);
                    log("Metadata not found for file: "+tAbstractFile.path+", skipped.");
                    return;
                }
                if (!metadata.frontmatter){
                    notesWithoutFrontmatter.push(tAbstractFile);
                    log("Frontmatter not found for file: "+tAbstractFile.path+", skipped.");
                    return;
                }
                const wiki_tag = metadata.frontmatter['wiki-tag'];
                if (!wiki_tag) {
                    notesWithoutWikiTag.push(tAbstractFile);
                    log("Wiki tag not found for file: "+tAbstractFile.path+", skipped.");
                    return;
                }
                const node = {file: tAbstractFile, metadata: metadata, parents: [], children: [], scc: null, wiki_tag: wiki_tag};
                if (wiki_tag in duplicated){
                    duplicated[wiki_tag].push(node);
                } else if (wiki_tag in nodes){
                    duplicated[wiki_tag] = [nodes[wiki_tag], node];
                    delete nodes[wiki_tag];
                } else {
                    nodes[wiki_tag] = node;
                }
            }
        });
        const wikiEntries: Node[] = [];
        const categories: Node[] = [];
        const disambiguationNotes: Node[] = [];
        const otherTypeNotes: Node[] = [];
        for (const wiki_tag in nodes) {
            const node = nodes[wiki_tag];
            const metadata = node.metadata!;
            const frontmatter = metadata.frontmatter!;
            if (frontmatter['note-type'] === 'wiki') {
                wikiEntries.push(node);
            } else if (frontmatter['note-type'] === 'category') {
                categories.push(node);
            } else if (frontmatter['note-type'] === 'disambiguation') {
                disambiguationNotes.push(node);
            } else {
                otherTypeNotes.push(node);
            }
        }

        // Initialize graph.
        for (const wiki_tag in nodes){
            const node = nodes[wiki_tag];
            const tags = node.metadata!.frontmatter!.tags;
            for (const tag of tags){
                if (tag in nodes) {
                    node.parents.push(nodes[tag as string]);
                    (nodes[tag] as Node).children.push(node);
                }
            }
        }

        var index_counter: number = 0;
        const stack: string[] = [];
        const on_stack: Set<string> = new Set();
        const low_links: {[wiki_tag: string]: number} = {};
        const indices: {[wiki_tag: string]: number} = {};
        const SCCs: {[wiki_tag: string]: SCC} = {};
        function strong_connect(node: Node): void{
            // Set index and lowlink for current node.
            const wiki_tag = node.wiki_tag;
            indices[wiki_tag] = index_counter;
            low_links[wiki_tag] = index_counter;
            index_counter++;
            stack.push(wiki_tag);
            on_stack.add(wiki_tag);
            // Consider successors of current node.
            for (const parent of node.parents){
                if (!(parent.wiki_tag in indices)){
                    // Successor has not yet been visited; recurse on it.
                    strong_connect(parent);
                    low_links[wiki_tag] = Math.min(low_links[wiki_tag], low_links[parent.wiki_tag]);
                } else if (on_stack.has(parent.wiki_tag)){
                    // the successor is in stack and hence in the current SCC
                    low_links[wiki_tag] = Math.min(low_links[wiki_tag], indices[parent.wiki_tag]);
                }
            }
            
            // If current node is a root node, pop the stack and generate an SCC.
            if (low_links[wiki_tag] === indices[wiki_tag]){
                const scc: SCC = {nodes: [], parents: [], children: [], pseudo_wiki_tag: wiki_tag};
                var w: string|undefined;
                while (true){
                    w = stack.pop();
                    if (w === undefined) error("stack underflow");
                    on_stack.delete(w!);
                    const node = nodes[w!];
                    scc.nodes.push(node);
                    if (w == wiki_tag) break;
                }
                SCCs[wiki_tag] = scc;
            }
        }

        // Find all SCCs.
        for (const wiki_tag in nodes){
            if (!(wiki_tag in indices)){
                strong_connect(nodes[wiki_tag]);
            }
        }

        // Assign SCCs to nodes.
        for (const pseudo_wiki_tag in SCCs){
            const scc = SCCs[pseudo_wiki_tag];
            for (const node of scc.nodes){
                node.scc = scc;
            }
        }

        // Calculate parents and children of SCCs.
        for (const pseudo_wiki_tag in SCCs){
            const scc = SCCs[pseudo_wiki_tag];
            for (const node of scc.nodes){
                const parentSCCs: SCC[] = [];
                for (const parent of node.parents){
                    const parentSCC = parent.scc!;
                    if (parentSCC !== scc && !parentSCC.parents.includes(scc)){
                        parentSCCs.push(parentSCC);
                    }
                }
                const childSCCs: SCC[] = [];
                for (const child of node.children){
                    const childSCC = child.scc!;
                    if (childSCC !== scc && !childSCC.children.includes(scc)){
                        childSCCs.push(childSCC);
                    }
                }
                scc.parents = parentSCCs;
                scc.children = childSCCs;
            }
        }

        this.nodes = nodes;
        this.wikiEntries = wikiEntries;
        this.categories = categories;
        this.disambiguationNotes = disambiguationNotes;
        this.duplicated = duplicated;
        this.otherTypeNotes = otherTypeNotes;
        this.SCCs = SCCs;
    }

    apply_tag_inheritance(){
        function apply_tag_inheritance_rec(scc: SCC, tags: string[] = []): void{
            // Inside SCC, share all tags.
            for (const node of scc.nodes){
                const node_tags = node.metadata!.frontmatter!.tags;
                if (!node_tags) node.metadata!.frontmatter!.tags = tags.slice();
                else node.metadata!.frontmatter!.tags = node_tags.concat(tags.filter(tag => !node_tags.includes(tag)));
            }
            tags.push(scc.pseudo_wiki_tag);
            // Spread tags to children.
            for (const child of scc.children){
                apply_tag_inheritance_rec(child, scc.nodes.map(node => node.wiki_tag));
            }
        }
        for (const scc of Object.values(this.SCCs).filter(scc => scc.parents.length == 0)){
            apply_tag_inheritance_rec(scc);
        }
    }

    async report_if_necessary(): Promise<void>{
        const bigSCCs = Object.values(this.SCCs).filter(scc => scc.nodes.length > 1);
        var report_necessary = false;
        var report_content = "# Wiki Library Problem Report\n\n";
        if (this.notesWithoutMetadata.length > 0) {
            report_content += "## Notes without metadata\n" + this.notesWithoutMetadata.map(file => "- "+file.path).join('\n') + "\n\n";
            report_necessary = true;
        }
        if (this.notesWithoutFrontmatter.length > 0) {
            report_content += "## Notes without frontmatter\n" + this.notesWithoutFrontmatter.map(file => "- "+file.path).join('\n') + "\n\n";
            report_necessary = true;
        }
        if (this.notesWithoutWikiTag.length > 0) {
            report_content += "## Notes without wiki tag\n" + this.notesWithoutWikiTag.map(file => "- "+file.path).join('\n') + "\n\n";
            report_necessary = true;
        }
        if (Object.keys(this.duplicated).length > 0) {
            report_content += "## Duplicated wiki tags\n" + Object.keys(this.duplicated).map(wiki_tag => {
                const nodes = this.duplicated[wiki_tag];
                return `
- ${wiki_tag}: ${nodes.map(node => '\n  - [['+node.file.name+']]')}
    `.trim();
            }).join('\n') + "\n\n";
            report_necessary = true;
        }
        if (bigSCCs.length > 0) {
            report_content += "## Mergeable SCCs\n" + bigSCCs.map(scc => {
                return `
- ${scc.nodes.map(node => node.wiki_tag).join(' / ')}: ${scc.nodes.map(node => '\n  - [['+node.file.name+']]')}
        `.trim();
            }).join('\n') + "\n\n";
            report_necessary = true;
        }

        if (report_necessary){
            var problemReportTFile = this.app.vault.getFileByPath('.wiki_library_problem_report.md');
            if (problemReportTFile){
                await this.app.vault.modify(problemReportTFile, report_content);
            } else {
                problemReportTFile = await this.app.vault.create(".wiki_library_problem_report.md", report_content);
            }
            await open_file(this.app, problemReportTFile);
        }
    }

    async addNewEntry(folder: string|TFolder, title: string, wiki_tag: string, aliases: string[], tags: string[], description: string, titleItems: string[]): Promise<void> {
        const similarities = await this.similarityAnalyze(wiki_tag, aliases, titleItems);
        if (similarities.length > 0) {
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
        var sameTitleNote = Object.values(this.nodes).filter(note => note.file.name == title)
        if (sameTitleNote.length > 0) {
            console.log("note already exists");
            log("Wiki note with exactly the same title already exists, open it instead.");
            await open_file(this.app, sameTitleNote[0].file);
            return;
        }

        // # create new note
        // const frontmatter = {
        //     "note-type": "wiki",
        //     date: new Date().toLocaleDateString(),
        //     time: new Date().toLocaleTimeString(),
        //     aliases: ['#'+wiki_tag].concat(aliases),
        //     tags: [wiki_tag].concat(tags).map(tag => '#'+tag),
        //     "wiki-tag": wiki_tag,
        //     description: description        
        // };

        // var content = '---\n' + stringifyYaml(frontmatter) + '---\n' + this.entryTemplate.replace('{{title}}', title);
        const content = this.entryTemplate.replace('{{title}}', title);

        const newNoteFilePath = folder.path+'/'+title+'.md'
        const newWikiEntry = await this.app.vault.create(newNoteFilePath, content);
        const cache = this.app.metadataCache.getFileCache(newWikiEntry);
        cache!.frontmatter!["note-type"] = "wiki";
        cache!.frontmatter!.date = new Date().toLocaleDateString();
        cache!.frontmatter!.time = new Date().toLocaleTimeString();
        cache!.frontmatter!.aliases = ['#'+wiki_tag].concat(aliases);
        cache!.frontmatter!.tags = [wiki_tag].concat(tags).map(tag => '#'+tag);
        cache!.frontmatter!["wiki-tag"] = wiki_tag;
        cache!.frontmatter!.description = description;

        // # post process wiki entry creation: update wiki summary
        console.log("post process wiki entry creation");
        const node = {file: newWikiEntry, metadata: cache, parents: [], children: [], scc: null, wiki_tag: wiki_tag};
        if (wiki_tag in this.nodes) {
            const nodeAlreadyExists = this.nodes[wiki_tag];
            delete this.nodes[wiki_tag];
            this.duplicated[wiki_tag] = [nodeAlreadyExists, node];
        } else {
            // TODO: update SCCs. (maybe merge existing SCCs)
            // TODO: update tags.
            this.nodes[wiki_tag] = node;
        }
        // this.summary['files'][newNoteFilePath] = frontmatter;
        // this.summary.updated_at = new Date().getTime();
        // this.app.vault.modify(this.summaryTFile, JSON.stringify(this.summary, null, 2));

        // # open note
        await open_file(this.app, newWikiEntry);

        log("New Wiki Entry '"+title+"' created successfully!", 3);
    }

    async similarityAnalyze(wiki_tag: string, aliases: string[], titleEntities: string[]): Promise<SimilarityInfo[]>{
        var similarities = this.nodes.map((fm) => {
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

    async refreshTagInheritance(fm: Node): Promise<void>{
        // Not recursive.
        const new_tags: Set<string> = new Set();
        for (const tag of fm.metadata!.frontmatter!.tags){
            if (tag in this.wiki_tag_dict){
                const parents = this.wiki_tag_dict[tag];
                if (parents.length == 1){
                    const parent = parents[0];
                    if (parent.metadata!.frontmatter!["note-type"] === "category") continue;
                    for (const parent_tag of parent.metadata!.frontmatter!.tags){
                        new_tags.add(parent_tag);
                    }
                } else {
                    log("Warning: duplicated wiki tag inheritance. Skipped.");
                }
            }
        }
        for (const tag of new_tags){
            if (!(tag in fm.metadata!.frontmatter!.tags)){
                fm.metadata!.frontmatter!.tags.push(tag);
            }
        }
    }

    async refreshAllTagInheritance(): Promise<void>{
        interface Node{
            wiki_tag: string;
            file: TFile;
            metadata: CachedMetadata;
            parents: string[];
            children: string[];
            processed: boolean;
        }
        interface SCC{ // Strongly connected component.
            nodes: Node[];
            processed: boolean;
            parents: string[];
            children: string[];
        }
        const nodes: {[wiki_tag: string]: Node} = {};
        // Initialize graph.
        for (const fm of this.nodes){
            const metadata = fm.metadata;
            if (!metadata) error("Metadata not found for file: "+fm.file.path);
            const frontmatter = metadata!.frontmatter;
            if (!frontmatter) error("Frontmatter not found for file: "+fm.file.path);
            const wiki_tag = frontmatter!['wiki-tag'];
            if (!wiki_tag) error("Wiki tag not found in frontmatter of file: "+fm.file.path);
            const tags = frontmatter!.tags;
            if (!tags) error("Tags not found in frontmatter of file: "+fm.file.path);
            if (wiki_tag in this.duplicated_wiki_tags) {
                // duplicated wiki tag. skip all.
                continue;
            }
            nodes[wiki_tag] = {wiki_tag, file: fm.file, metadata: metadata!, parents: [], children: [], processed: false};
        }
        // Initialize 'parents' and 'children' fields.
        for (const wiki_tag in nodes){
            const node = nodes[wiki_tag];
            const tags = node.metadata.frontmatter!.tags;
            for (const tag of tags){
                if (tag in nodes) {
                    node.parents.push(tag);
                    (nodes[tag] as Node).children.push(wiki_tag);
                }
            }
        }

        var index_counter: number = 0;
        const stack: string[] = [];
        const on_stack: Set<string> = new Set();
        const low_links: {[wiki_tag: string]: number} = {};
        const indices: {[wiki_tag: string]: number} = {};
        const sccs: SCC[] = [];
        function strong_connect(wiki_tag: string): void{
            // Set index and lowlink for current node.
            indices[wiki_tag] = index_counter;
            low_links[wiki_tag] = index_counter;
            index_counter++;
            stack.push(wiki_tag);
            on_stack.add(wiki_tag);
            // Consider successors of current node.
            const node = nodes[wiki_tag];
            for (const parent of node.parents){
                if (!(parent in indices)){
                    // Successor has not yet been visited; recurse on it.
                    strong_connect(parent);
                    low_links[wiki_tag] = Math.min(low_links[wiki_tag], low_links[parent]);
                } else if (on_stack.has(parent)){
                    // the successor is in stack and hence in the current SCC
                    low_links[wiki_tag] = Math.min(low_links[wiki_tag], indices[parent]);
                }
            }
            
            // If current node is a root node, pop the stack and generate an SCC.
            if (low_links[wiki_tag] === indices[wiki_tag]){
                const scc: SCC = {nodes: [], processed: false, parents: [], children: []};
                var w: string|undefined;
                while (true){
                    w = stack.pop();
                    if (w === undefined) error("stack underflow");
                    on_stack.delete(w!);
                    const node = nodes[w!];
                    scc.nodes.push(node);
                    scc.parents = scc.parents.concat(node.parents);
                    scc.children = scc.children.concat(node.children);
                    if (w == wiki_tag) break;
                }
                scc.parents = Array.from(new Set(scc.parents)).filter(tag => !(tag in scc.nodes));
                scc.children = Array.from(new Set(scc.children)).filter(tag => !(tag in scc.nodes));
                sccs.push(scc);
            }
        }

        // Find all SCCs.
        for (const wiki_tag in nodes){
            if (!(wiki_tag in indices)){
                strong_connect(wiki_tag);
            }
        }
    }

    async refresh(): Promise<void>{
        // TODO
    }

    async merge(fms: Node[]): Promise<void>{
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
        contentEl.createEl('h2', { text: "Similar note(s) found" });
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