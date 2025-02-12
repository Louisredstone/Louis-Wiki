import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFolder, TFile, TextComponent } from 'obsidian';
import { WikiLibrary } from './wiki_library';
import { log, error, convert_to_legal_tag } from './utils';
import { inputPrompt } from './gui/inputPrompt';
import { suggester } from './gui/suggester';

export interface LouisWikiPluginSettings {
	wikiFolder: string|null;
	tagAliasEnabled: boolean;
	entryTemplate: string;
	debug: boolean;
}

const DEFAULT_SETTINGS: LouisWikiPluginSettings = {
	wikiFolder: 'Wiki',
	tagAliasEnabled: false,
	entryTemplate: `{{title}}

# 相关链接
\`\`\`dataviewjs
dv.list(dv.pages('#'+dv.current().file.frontmatter['wiki-tag']).map(n => n.file.link))
\`\`\`

`,
	debug: false
}

export default class LouisWikiPlugin extends Plugin {
	settings: LouisWikiPluginSettings;
	wikiLibrary: WikiLibrary;
	
	async onload() {
		await this.loadSettings();
		await this.initWikiLibrary();

		// // This creates an icon in the left ribbon.
		// const ribbonIconEl = this.addRibbonIcon('dice', 'Sample Plugin', (evt: MouseEvent) => {
		// 	// Called when the user clicks the icon.
		// 	new Notice('This is a notice!');
		// });
		// // Perform additional things with the ribbon
		// ribbonIconEl.addClass('my-plugin-ribbon-class');

		// // This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		// const statusBarItemEl = this.addStatusBarItem();
		// statusBarItemEl.setText('Status Bar Text');

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'create-new-wiki-entry',
			name: 'Create new wiki entry',
			callback: () => {
				this.Command_CreateNewWikiEntry();
			}
		});

		this.addCommand({
			id: 'create-new-disambiguation-wiki-entry',
			name: 'Create new disambiguation wiki entry',
			callback: () => {
				this.Command_CreateNewDisambiguationWikiEntry();
			}
		});

		this.addCommand({
			id: 'create-new-category',
			name: 'Create new category',
			callback: () => {
				this.Command_CreateNewCategoryWikiEntry();
			}
		});

		this.addCommand({
			id: 'refresh-wiki-library',
			name: 'Refresh wiki library',
			callback: () => {
				this.Command_RefreshWikiLibrary();
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		// this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
		// 	console.log('click', evt);
		// 	// TODO: input '##' to trigger a suggester of category tags.
		// });

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async initWikiLibrary(){
		if (!this.settings.wikiFolder) {
			log('Please set the wiki folder in the settings.');
			return;
		}
		this.wikiLibrary = await WikiLibrary.createAsync(this.app, this.settings);
	}

	async Command_CreateNewWikiEntry(){
		// prompt user for title and meta information
		// find similar entries. if any, prompt user to confirm
        // disambiguate if necessary
		// choose folder
        // create new file
		if (!this.wikiLibrary) error('Wiki library not initialized.');
		const userInput = await inputPrompt('Create new wiki entry', '', 'Only Name is required, other fields are optional.\nName can be en/zh/abbr.\nName will become the wiki-tag.\n Aliases and tags will be processed automatically.', 'Name, alias1, alias2, #tag1, #tag2, //description')
		// e.g.:
		// 通用人工智能 (Artificial General Intelligence, AGI)
		// QuickAdd, 快加 (QA): Obsidian插件
		if (userInput == null) {
			console.log("Operation canceled by user.");
			log("Operation canceled by user.", 5);
			return;
		}

		// # parse wiki input
		function parse_wiki_input(userInput: string){
			console.log("parse wiki input");
			const parts: string[] = userInput.split(/\/\//);
			
			var chineseNames: string[] = [];
			var englishNames: string[] = [];
			var abbrNames: string[] = [];
			var description: string = "";
		
			const firstPart: string = parts[0];
			if (parts.length>1){
				description= parts[1];
			}
			
			const entities: string[] = firstPart.replace(/\s*([,，]\s*)*[,，]?(#[^\s\~\`\!\@\#\$\%\^\&\*\(\)]+)\s*([,，]\s*)*[,，]?/g, (match, p1, p2, p3)=>","+p2+",").split(/[,，]/).map(part => part.trim()).filter(part => part!== '');
			
			const tags: string[] = entities.filter(entity => entity.startsWith('#')).map(entity => entity.slice(1));
			const names: string[] = entities.filter(entity =>!entity.startsWith('#'));

			const namesWithType: string[][] = names.map(entity => {
				if (/[^\x00-\x7F]+/.test(entity)) { // isChinese
					chineseNames.push(entity);
					return [entity, 'chinese-name'];
				} else if (entity.match(/[A-Z]/g) && (entity.match(/[A-Z]/g)!.length / entity.length) >= 0.3) { // isAbbreviation
					abbrNames.push(entity);
					return [entity, 'abbreviation'];
				} else {
					englishNames.push(entity);
					return [entity, 'english-name'];
				}
			});
			// Note that namesWithType is an array of [name, type] pairs.
			return {
				chineseNames: chineseNames,
				englishNames: englishNames,
				abbrNames: abbrNames,
				aliases: names,
				tags: tags,
				description: description,
				namesWithType: namesWithType
			}
		}

		const {
			chineseNames,
			englishNames,
			abbrNames,
			aliases,
			tags,
			description, 
			namesWithType: namesWithType
		} = parse_wiki_input(userInput);

		// # decide title and wiki-tag
		function generate_wiki_title_and_wikiTag(namesWithType: string[][]){
			// # generate wiki title and wiki-tag
			console.log("generate wiki title and wiki-tag");
			var titleEntities: string[] = [];
			// A title can be composed of multiple entities, such as:
			// AI (Artificial Intelligence, 人工智能)
			// At most three entities, one for zh/en/abbr each.
			// The sequence of entities is determined by the order of appearance in the input string.
			var flag_chinese: boolean = false;
			var flag_english: boolean = false;
			var flag_abbreviation: boolean = false;
			for (var [entity, type] of namesWithType){
				if (type === 'abbreviation' && !flag_abbreviation){
					titleEntities.push(entity);
					flag_abbreviation = true;
				} else if (type === 'chinese-name' && !flag_chinese) {
					titleEntities.push(entity);
					flag_chinese = true;
				} else if (type === 'english-name' && !flag_english) {
					titleEntities.push(entity);
					flag_english = true;
				}
			}
			var title: string = titleEntities[0];
			if (titleEntities.length > 1) title += ' ('+titleEntities.slice(1).join(', ') +')';
			var wiki_tag: string = convert_to_legal_tag(titleEntities[0]);
			return { title: title, wiki_tag: wiki_tag,  titleEntities };
		}

		const {
			title, 
			wiki_tag,
			titleEntities
		} = generate_wiki_title_and_wikiTag(namesWithType);

		this.wikiLibrary.init_folders();
		const folders = this.wikiLibrary.folders;
		const chosenFolder: TFolder = await suggester(this.app, folders.map(folder => folder.path), folders) // TODO: create new folder if necessary.

		this.wikiLibrary.addNewEntry(chosenFolder, title, wiki_tag, aliases, tags, description, titleEntities);
	}

	async Command_CreateNewDisambiguationWikiEntry(){
		if (!this.wikiLibrary) error('Wiki library not initialized.');
		error('Not implemented yet.');
	}

	async Command_CreateNewCategoryWikiEntry(){
		// 类型wiki, 固定放在某个路径下, 此路径下的wiki_tag不会被继承.
		// 比如, "方法", "数据集", ""
		error('Not implemented yet.');
	}

	async Command_RefreshWikiLibrary(){
		// 检查每个WikiEntry的metadata是否完整, 如果不完整则标准化.
		this.wikiLibrary.refresh();
	}

	async EditorCommand_InsertZoteroReferenceFromClipboard(){
		// TODO: implement this.
		error('Not implemented yet.');

	}
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: LouisWikiPlugin;

	constructor(app: App, plugin: LouisWikiPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		// new Setting(containerEl)
		// 	.setName('Wiki Folder')
		// 	.setDesc('The folder where your wiki entries are stored.')
		// 	.addText(text => text
		// 		.setPlaceholder('/path/to/wiki/folder')
		// 		.setValue(this.plugin.settings.wikiFolder || '')
		// 		.onChange(async (value) => {
		// 			if (value !== this.plugin.settings.wikiFolder){
		// 				this.plugin.settings.wikiFolder = value;
		// 				if (value !== null && value.trim() !== '')
		// 					this.plugin.wikiLibrary = await WikiLibrary.createAsync(this.app, this.plugin.settings);
		// 				await this.plugin.saveSettings();
		// 			}
		// 		})
		// 	);
		var wikiFolderTextBox: TextComponent;
		new Setting(containerEl)
		.setName('Wiki Folder')
		.setDesc('The folder where your wiki entries are stored.')
		.addText(text => {
			text.setPlaceholder('/path/to/wiki/folder')
			.setValue(this.plugin.settings.wikiFolder || '');
			wikiFolderTextBox = text;
		    }
		).addButton(button => {
			button.setButtonText('Apply');
			button.onClick(async () => {
				const value = (wikiFolderTextBox as TextComponent).getValue();
				this.plugin.settings.wikiFolder = value;
				if (value !== null && value.trim() !== '')
					this.plugin.wikiLibrary = await WikiLibrary.createAsync(this.app, this.plugin.settings);
				await this.plugin.saveSettings();
			});
		});

		new Setting(containerEl)
			.setName('Debug')
			.setDesc('(For developers) Enable debug mode.')
			.addButton(button => button
				.setButtonText(this.plugin.settings.debug? 'Disable' : 'Enable')
				.onClick(async () => {
					this.plugin.settings.debug = !this.plugin.settings.debug;
					await this.plugin.saveSettings();
					button.setButtonText(this.plugin.settings.debug ? 'Disable' : 'Enable');
				})
			);
	}
}



