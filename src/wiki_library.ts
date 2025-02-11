// add new wiki entry
// update wiki library

import { App, Vault, Notice, TFolder, TFile, Modal, ButtonComponent, parseYaml, stringifyYaml, getFrontMatterInfo } from 'obsidian';
import {log, error, basename, open_file, open_file_by_path, get_sub_folders, delete_element} from './utils';
import { yesNoPrompt } from './gui/yesNoPrompt';
import { suggester } from './gui/suggester';
import { LouisWikiPluginSettings } from './main'

type Dict = {[key: string]: any};

class Node{
    file: TFile;
    frontmatter: Dict;
    parents: Node[];
    children: Node[];
    scc: SCC|null;
    wiki_tag: string;

    frontmatter_modified: boolean = false;

    constructor(file: TFile, wiki_tag: string|null = null, parents: Node[] = [], children: Node[] = [], scc: SCC|null = null){
        this.file = file;
        this.parents = parents;
        this.children = children;
        this.scc = scc;
        this.init_frontmatter();
        if (!this.frontmatter) return;
        if (wiki_tag)
            this.wiki_tag = wiki_tag;
        else
            this.wiki_tag = this.frontmatter.wiki_tag;
    }

    async init_frontmatter(): Promise<void>{
        // TODO: check if cachedMetadata is available
        const content = await this.file.vault.read(this.file);
        const frontmatterInfo = getFrontMatterInfo(content);
        this.frontmatter = parseYaml(frontmatterInfo.frontmatter);
        this.frontmatter_modified = false;
    }

    add(field: string, value: any){
        const plurals: Dict = {'tag': 'tags', 'alias': 'aliases'}
        if (field in plurals){
            const plural = plurals[field];
            if (plural in this.frontmatter){
                if (this.frontmatter[plural].includes(value)) return;
                this.frontmatter[plural].push(value);
                this.frontmatter_modified = true;
            } else {
                this.frontmatter[plural] = [value];
                this.frontmatter_modified = true;
            }
            return;
        } 
        else error("Invalid field: "+field);
    }

    set_frontmatter(field: string, value: any){
        // if (field in this.frontmatter && this.frontmatter[field] === value) return;
        this.frontmatter[field] = value;
        this.frontmatter_modified = true;
    }

    get(field: string){
        return this.frontmatter[field];
    }

    async save_frontmatter(): Promise<void>{
        if (!this.frontmatter_modified) return;
        const content = await this.file.vault.read(this.file);
        const frontmatterInfo = getFrontMatterInfo(content);
        const {from: frontmatterStart, contentStart} = frontmatterInfo;
        await this.file.vault.modify(this.file, content.slice(0, frontmatterStart) + stringifyYaml(this.frontmatter) + content.slice(contentStart));
        this.frontmatter_modified = false;
    }
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
    debug: boolean = false;
    rootFolderPath: string;
    rootFolder: TFolder;
    folders: TFolder[] = [];
    entryTemplate: string;

    nodes: {[wiki_tag: string]: Node} = {};
    SCCs: {[wiki_tag: string]: SCC} = {};
    // legal note-types: wiki, category, disambiguation
    wikiEntries: Node[] = [];
    disambiguationNotes: Node[] = [];
    categories: Node[] = [];
    otherTypeNotes: Node[]  = [];
    // abnormal notes
    // notesWithoutMetadata: TFile[] = [];
    notesWithoutFrontmatter: TFile[] = [];
    // notesWithoutWikiTag: TFile[] = [];
    duplicated: {[wiki_tag: string]: Node[]};

    outerTagRefs: {[tag: string]: Node[]} = {};
    
    constructor(app: App, settings: LouisWikiPluginSettings) {
        log("Initializing wiki library...");
        const { wikiFolder: rootFolder, entryTemplate } = settings;
        if (!rootFolder) {
            error("Root folder not specified, please set it in settings.");
            return;
        }
        this.app = app;
        this.debug = settings.debug;
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
        // const notesWithoutMetadata: TFile[] = [];
        const notesWithoutFrontmatter: TFile[] = [];
        // const notesWithoutWikiTag: TFile[] = [];
        const duplicated: {[wiki_tag: string]: Node[]} = {};
        // Initialize nodes.
        Vault.recurseChildren(this.rootFolder, (tAbstractFile)=>{
            if (tAbstractFile instanceof TFile && tAbstractFile.extension ==='md')
            {
                // const metadata = this.app.metadataCache.getFileCache(tAbstractFile);
                // if (!metadata) {
                //     notesWithoutMetadata.push(tAbstractFile);
                //     log("Metadata not found for file: "+tAbstractFile.path+", skipped.");
                //     return;
                // }
                // if (!metadata.frontmatter){
                //     notesWithoutFrontmatter.push(tAbstractFile);
                //     log("Frontmatter not found for file: "+tAbstractFile.path+", skipped.");
                //     return;
                // }
                // const wiki_tag = metadata.frontmatter['wiki-tag'];
                // if (!wiki_tag) {
                //     notesWithoutWikiTag.push(tAbstractFile);
                //     log("Wiki tag not found for file: "+tAbstractFile.path+", skipped.");
                //     return;
                // }
                const node = new Node(tAbstractFile);
                if (!node.frontmatter){
                    notesWithoutFrontmatter.push(tAbstractFile);
                    log("Frontmatter not found for file: "+tAbstractFile.path+", skipped.");
                    return;
                }
                const wiki_tag = node.wiki_tag;
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
            // const metadata = node.frontmatter!;
            // const frontmatter = metadata.frontmatter!;
            const note_type = node.get('note-type');
            if (note_type === 'wiki') {
                wikiEntries.push(node);
            } else if (note_type === 'category') {
                categories.push(node);
            } else if (note_type === 'disambiguation') {
                disambiguationNotes.push(node);
            } else {
                otherTypeNotes.push(node);
            }
        }

        // Initialize graph.
        for (const wiki_tag in nodes){
            const node = nodes[wiki_tag];
            const tags = node.frontmatter.tags;
            for (const tag of tags){
                if (tag in nodes) {
                    node.parents.push(nodes[tag as string]);
                    (nodes[tag] as Node).children.push(node);
                } else {
                    if (tag in this.outerTagRefs)
                        this.outerTagRefs[tag].push(node);
                    else
                        this.outerTagRefs[tag] = [node];
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
        this.otherTypeNotes = otherTypeNotes;
        this.SCCs = SCCs;

        this.notesWithoutFrontmatter = notesWithoutFrontmatter;
        // this.notesWithoutMetadata = notesWithoutMetadata;
        // this.notesWithoutWikiTag = notesWithoutWikiTag;
        this.duplicated = duplicated;
    }

    apply_tag_inheritance(){
        function apply_tag_inheritance_rec(scc: SCC, tags: string[] = []): void{
            // Inside SCC, share all tags.
            for (const node of scc.nodes){
                const node_tags = node.frontmatter.tags;
                node.set_frontmatter('tags', node_tags.concat(tags.filter(tag => !node_tags.includes(tag))));
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
        // if (this.notesWithoutMetadata.length > 0) {
        //     report_content += "## Notes without metadata\n" + this.notesWithoutMetadata.map(file => "- "+file.path).join('\n') + "\n\n";
        //     report_necessary = true;
        // }
        if (this.notesWithoutFrontmatter.length > 0) {
            report_content += "## Notes without frontmatter\n" + this.notesWithoutFrontmatter.map(file => "- "+file.path).join('\n') + "\n\n";
            report_necessary = true;
        }
        // if (this.notesWithoutWikiTag.length > 0) {
        //     report_content += "## Notes without wiki tag\n" + this.notesWithoutWikiTag.map(file => "- "+file.path).join('\n') + "\n\n";
        //     report_necessary = true;
        // }
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
        this.debug_log("WikiLibrary.addNewEntry called.");
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

        this.debug_log("Checking if note already exists...");
        // # check if note already exists
        var sameTitleNote = Object.values(this.nodes).filter(note => note.file.name == title)
        if (sameTitleNote.length > 0) {
            console.log("note already exists");
            log("Wiki note with exactly the same title already exists, open it instead.");
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

        this.debug_log("Creating new note...");
        const content = '---\n' + stringifyYaml(frontmatter) + '---\n' + this.entryTemplate.replace('{{title}}', title);
        // const content = this.entryTemplate.replace('{{title}}', title);

        const newNoteFilePath = folder.path+'/'+title+'.md'
        const newWikiEntry = await this.app.vault.create(newNoteFilePath, content);
        // const cache = this.app.metadataCache.getFileCache(newWikiEntry);
        // if (!cache) {
        //     this.debug_log("Metadata cache not found for new note.");
        // }

        this.debug_log("Post processing wiki entry...");
        // # post process wiki entry creation: update wiki summary
        console.log("post process wiki entry creation");
        // const newNode: Node = {file: newWikiEntry, frontmatter: cache, parents: [], children: [], scc: null, wiki_tag: wiki_tag};
        const newNode = new Node(newWikiEntry, wiki_tag);
        if (wiki_tag in this.nodes) { // duplicated wiki tag.
            this.debug_log("Duplicated wiki tag found, merging notes.");
            const nodeAlreadyExists = this.nodes[wiki_tag];
            for(const parent of nodeAlreadyExists.parents){
                delete_element(parent.children, nodeAlreadyExists);
            }
            for(const child of nodeAlreadyExists.children){
                delete_element(child.parents, nodeAlreadyExists);
            }
            const existingSCC = nodeAlreadyExists.scc!;
            if (existingSCC.nodes.length == 1){
                for(const parent of existingSCC.parents){
                    delete_element(parent.children, existingSCC);
                }
                for(const child of existingSCC.children){
                    delete_element(child.parents, existingSCC);
                }
                delete this.SCCs[existingSCC.pseudo_wiki_tag];
            } else {
                delete_element(existingSCC.nodes, nodeAlreadyExists);
            }
            delete this.nodes[wiki_tag];
            this.duplicated[wiki_tag] = [nodeAlreadyExists, newNode];
        } else { // new unique wiki tag.
            this.debug_log("New unique wiki tag found, creating new SCC.")
            const newSCC: SCC = {nodes: [newNode], parents: [], children: [], pseudo_wiki_tag: wiki_tag};
            newNode.scc = newSCC;
            for(const tag of newNode.frontmatter.tags){
                if (tag in this.nodes){
                    const parent = this.nodes[tag as string];
                    newSCC.parents.push(parent.scc!);
                    parent.scc!.children.push(newSCC);
                    const parentTags = parent.frontmatter.tags;
                    for(const parent_tag of parentTags){
                        if (parent_tag in this.nodes
                            && this.nodes[parent_tag as string].frontmatter["note-type"] != "category"
                            && !newNode.frontmatter.tags.includes(parent_tag)){
                            newNode.frontmatter.tags.push(parent_tag);
                        }
                    }
                    for(const uncle of parent.scc!.nodes){
                        newNode.parents.push(uncle);
                        uncle.children.push(newNode);
                    }
                }
            }
            this.debug_log("Check if new entry is subscribed...")
            if (wiki_tag in this.outerTagRefs){
                // This new entry would be a 'subscribed' one, who has already had some subscribers before it really comes.
                // In this case, maybe some SCCs should be merged.
                for(const child of this.outerTagRefs[wiki_tag]){
                    // If new node (now) has some tags belongs to the subscribers (this.outerTagRefs[tag]), it means these tags have been spread to the new node.
                    // Therefore, all the SCCs on this spread chain should be merged.
                    child.parents.push(newNode);
                    newNode.children.push(child);
                }
                delete this.outerTagRefs[wiki_tag];
                var super_index_counter: number = 0;
                const super_stack: string[] = [];
                const super_on_stack: Set<string> = new Set();
                const super_low_links: {[wiki_tag: string]: number} = {};
                const super_indices: {[wiki_tag: string]: number} = {};
                const super_sccs: {[wiki_tag: string]: SCC[]} = {};
                function super_strong_connect(scc: SCC){
                    const pseudo_wiki_tag = scc.pseudo_wiki_tag;
                    super_indices[pseudo_wiki_tag] = super_index_counter;
                    super_low_links[pseudo_wiki_tag] = super_index_counter;
                    super_index_counter++;
                    super_stack.push(pseudo_wiki_tag);
                    super_on_stack.add(pseudo_wiki_tag);
                    
                    for(const parent of scc.parents){
                        if (!(parent.pseudo_wiki_tag in super_indices)){
                            super_strong_connect(parent);
                            super_low_links[pseudo_wiki_tag] = Math.min(super_low_links[pseudo_wiki_tag], super_low_links[parent.pseudo_wiki_tag]);
                        } else if (super_on_stack.has(parent.pseudo_wiki_tag)){
                            super_low_links[pseudo_wiki_tag] = Math.min(super_low_links[pseudo_wiki_tag], super_indices[parent.pseudo_wiki_tag]);
                        }
                    }

                    if (super_low_links[pseudo_wiki_tag] === super_indices[pseudo_wiki_tag]){
                        const super_scc: SCC[] = [];
                        var w: string|undefined;
                        while(true){
                            w = super_stack.pop();
                            if (w === undefined) error("stack underflow");
                            super_on_stack.delete(w!);
                            const scc = this.SCCs[w!];
                            super_scc.push(scc);
                            if (w == pseudo_wiki_tag) break;
                        }
                        super_sccs[pseudo_wiki_tag] = super_scc;
                    }
                }
                super_strong_connect(newSCC);
                const n_super_sccs = Object.keys(super_sccs).length;
                if (n_super_sccs > 1){
                    error("Error: Algorithm wrong, there are more than one Super SCCs.");
                    return;
                } else if (n_super_sccs == 1){
                    if (wiki_tag in super_sccs){
                        const super_scc = super_sccs[wiki_tag];
                        // merge SCCs in super_scc.
                        const newParentSCCs: Set<SCC> = new Set(newSCC.parents);
                        const newChildSCCs: Set<SCC> = new Set();
                        for(const scc of super_scc){
                            if (scc === newSCC) continue;
                            newSCC.nodes = newSCC.nodes.concat(scc.nodes);
                            for(const parent of scc.parents){
                                newParentSCCs.add(parent);
                                delete_element(parent.children, scc);
                                parent.children.push(newSCC);
                            }
                            for(const child of scc.children){
                                newChildSCCs.add(child);
                                delete_element(child.parents, scc);
                                child.parents.push(newSCC);
                            }
                            delete this.SCCs[scc.pseudo_wiki_tag];
                            // FIXME: the logic here is a bit complicated and fuzzy, I need to check it.
                        }
                        newSCC.parents = Array.from(newParentSCCs).filter(scc => !super_scc.includes(scc));
                        newSCC.children = Array.from(newChildSCCs).filter(scc => !super_scc.includes(scc));
                    } else {
                        error("Error: Algorithm wrong, new wiki_tag not in Super SCC.");
                        return;
                    }
                }
            }
            this.nodes[wiki_tag] = newNode;
            this.SCCs[wiki_tag] = newSCC;
        }

        log("Opening new note...")
        // # open note
        await open_file(this.app, newWikiEntry);

        log("New Wiki Entry '"+title+"' created successfully!", 3);
    }

    async similarityAnalyze(wiki_tag: string, aliases: string[], titleEntities: string[]): Promise<SimilarityInfo[]>{
        var similarityInfos = Object.values(this.nodes).map((node: Node) => {
            // const metadata = node.frontmatter;
            // if (!metadata) return null;
            // const frontmatter = metadata.frontmatter;
            // if (!frontmatter) return null;
            const frontmatter = node.frontmatter;
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
            return {fm: node, similarity, intersection_size};
        }).filter(info => info!= null);
        console.log("DEBUG insert 0");
        similarityInfos = similarityInfos.sort((a, b) => b.similarity - a.similarity).filter(item => item.similarity > 0.5 || item.intersection_size> 1);
        return similarityInfos;
    }

    async refresh(): Promise<void>{
        // TODO
    }

    async merge(fms: Node[]): Promise<void>{
        // TODO
    }

    debug_log(msg: string, duration: number = 3): void{
        if (this.debug) {
            log(msg, duration);
            console.log(msg);
        }
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
            if (fm.frontmatter) {
                const frontmatter = fm.frontmatter.frontmatter;
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