import { 
	App, 
	Editor, 
	MarkdownView, 
	Modal, 
	Notice, 
	Plugin, 
	PluginSettingTab, 
	Setting, 
	htmlToMarkdown,
	TFile,
	TFolder,
	Vault
} from 'obsidian';

export function log(msg: string, duration = 3) {
	const notice = new Notice(msg, duration*1000);
	return notice;
}

export function error(msg: string) {
	const notice = new Notice(msg, 0);
	throw new Error(msg);
}

export function max(a: number, b: number): number {
	return a>b? a : b;
}

export function getEditor(app: App){
    const activeEditor = app.workspace.activeEditor!;
    const editor = activeEditor.editor!;
    return editor;
}

export function convert_to_legal_tag(tag: string): string {
    return tag.replace(/[\!\@\#\$\%\^\&\*\\\~\`\,\.\<\>\?\{\}\[\]\'\"\+\=\s]/g, '_').replace(/\:/g, '__');
}

export function basename(path: string): string {
    return path.split('/').pop()!.split('.')[0];
}

export async function open_file(app: App, tFile: TFile){
	const leaf = app.workspace.getLeaf('tab');
	if (leaf){
		await leaf.openFile(tFile);
	}
}

export async function open_file_by_path(app: App, path: string){
	const tFile = app.vault.getAbstractFileByPath(path);
	if (tFile == null) return;
	if (tFile instanceof TFolder) return;
	await open_file(app, tFile as TFile);
}

export function get_sub_folders(tFolder: TFolder){
	var folders: TFolder[] = [];
	Vault.recurseChildren(tFolder, (tAbstractFile)=>{
		if (tAbstractFile instanceof TFolder)
			folders.push(tAbstractFile);
	});
	return folders;
}

export function get_sub_folders_by_path(app: App, folderPath: string){
	const tFolder = app.vault.getFolderByPath(folderPath)!;
	return get_sub_folders(tFolder);
}

export function exclude(arr: any[], element: any): any[] {
	return arr.filter(function(obj) {
		return obj!= element;
	});
}

export function delete_element(arr: any[], element: any): any[] {
	delete arr[arr.indexOf(element)];
	return arr;
}

// get_sub_folders_by_path = (obsidian, vault, folderPath) => {
//     tFolder = vault.getFolderByPath(folderPath);
//     return get_sub_folders(obsidian, tFolder);
// }

// updateFrontmatter = async (params) => {
//     const {
//         app,
//         obsidian,
//         tFile,
//         frontmatter
//     } = params;
//     var vault = app.vault;
//     fileContent = await vault.read(tFile);
//     frontMatterInfo = obsidian.getFrontMatterInfo(fileContent);
//     newFileContent = fileContent.slice(0, frontMatterInfo.from) + obsidian.stringifyYaml(frontmatter) + fileContent.slice(frontMatterInfo.to);
//     await vault.modify(tFile, newFileContent);
// }

// changeFrontmatterEntry = async (params) => {
//     // Change frontmatter entry in file or files in folder (provided by 'path' parameter)
//     // For example, change all 'noteType' entries to 'note-type'.
//     const {
//         app,
//         obsidian,
//         path,
//         originEntry,
//         newEntry
//     } = params;
//     log = (msg, duration = 0) => {
//         var notice = new obsidian.Notice(msg, duration*1000);
//         return notice;
//     };
//     var vault = app.vault;
//     // var cache = app.metadataCache;

//     var notice = log("Changing frontmatter entry `"+originEntry+"` to `"+newEntry+"`...");

//     var isFolder = false;
//     if (path.endsWith('/')) isFolder = true;
//     else {
//         var tFile = vault.getFileByPath(path);
//         if (tFile == null) isFolder = true;
//     }
//     var count = 0;
//     processTFile = async (tFile) => {
//         notice.setMessage("Processing file `"+tFile.path+"`...");
//         fileContent = await vault.read(tFile);
//         frontMatterInfo = obsidian.getFrontMatterInfo(fileContent);
//         if (!frontMatterInfo.exists) return;
//         frontmatter = obsidian.parseYaml(frontMatterInfo.frontmatter);
//         originValue = frontmatter[originEntry];
//         if (originValue == null) return;
//         delete frontmatter[originEntry];
//         newFrontmatter = {};
//         newFrontmatter[newEntry] = originValue;
//         for (var [key, value] of Object.entries(frontmatter)){
//             newFrontmatter[key] = value;
//         }
//         newFileContent = fileContent.slice(0, frontMatterInfo.from) + obsidian.stringifyYaml(newFrontmatter) + fileContent.slice(frontMatterInfo.to);
//         await vault.modify(tFile, newFileContent);
//         count += 1;
//     }
//     if (!isFolder){
//         if (tFile.extension !='md'){
//             log("Error: file `"+path+"` is not a markdown file.");
//             return;
//         }
//         await processTFile(tFile);
//         log("Updated frontmatter entry `"+originEntry+"` to `"+newEntry+"` in file `"+path+"`.");
//     } else {
//         var tFolder = vault.getFolderByPath(path);
//         var count = 0;
//         var tFiles = [];
//         obsidian.Vault.recurseChildren(tFolder, (tFile) => {
//             if (tFile.extension =='md') tFiles.push(tFile);
//         });
//         for (var tFile of tFiles){
//             await processTFile(tFile);
//         }
//         log("Updated frontmatter entry `"+originEntry+"` to `"+newEntry+"` in `"+count+"` file(s) in folder `"+path+"`.");
//     }
// };