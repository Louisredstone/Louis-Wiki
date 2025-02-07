import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFolder, TFile } from 'obsidian';
import { WikiLibrary } from './wiki_library';
import { log, error, convert_to_legal_tag } from './utils';
import { inputPrompt } from './gui/inputPrompt';
import { suggester } from './gui/suggester';

interface LouisWikiPluginSettings {
	wikiFolder: string|null;
	tagAliasEnabled: boolean;
}

const DEFAULT_SETTINGS: LouisWikiPluginSettings = {
	wikiFolder: null,
	tagAliasEnabled: false
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

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

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
		this.wikiLibrary = new WikiLibrary(this.app, this.settings.wikiFolder!);
	}

	async Command_CreateNewWikiEntry(){
		// prompt user for title and meta information
		// find similar entries. if any, prompt user to confirm
        // disambiguate if necessary
		// choose folder
        // create new file
		if (!this.wikiLibrary) error('Wiki library not initialized.');
		const str = await inputPrompt('Create new wiki entry', 'Name, alias1, alias2, #tag1, #tag2', 'Only Name is required, other fields are optional.\nName can be en/zh/abbr.\nName will become the wiki-tag.\n aliases and tags will be processed automatically.')
		// e.g.:
		// 通用人工智能 (Artificial General Intelligence, AGI)
		// QuickAdd, 快加 (QA): Obsidian插件
		if (str == null) {
			console.log("Operation canceled by user.");
			log("Operation canceled by user.", 5);
			return;
		}

		// # parse wiki input
		function parse_wiki_input(str: string){
			console.log("parse wiki input");
			const parts: string[] = str.split(/[:：]/);
			// #FIXME: need to change the grammar here.
			// it is still old code.
			
			var chineseNames: string[] = [];
			var englishNames: string[] = [];
			var abbrNames: string[] = [];
			var descriptions: string[] = [];
		
			const firstPart: string = parts[0];
			const entities: string[] = firstPart.split(/[（\(,，\)）]/).map(part => part.trim()).filter(part => part !== '');
			const namesWithType: string[][] = entities.map(entity => {
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
			if (parts.length > 1) {
				descriptions = parts.slice(1).join(',').split(',').map(item => item.trim()).filter(item => item!== '');
			}
			return {
				chineseNames: chineseNames,
				englishNames: englishNames,
				abbrNames: abbrNames,
				descriptions: descriptions,
				namesWithType: namesWithType
			}
		}

		const {
			chineseNames,
			englishNames,
			abbrNames: abbrNames, 
			descriptions, 
			namesWithType: namesWithType
		} = parse_wiki_input(str);

		// # decide title and wiki-tag
		function generate_wiki_title_and_wikiTag(namesWithType: string[][], descriptions: string[]=[]){
			// # generate wiki title and wiki-tag
			console.log("generate wiki title and wiki-tag");
			var titleItems: string[] = [];
			// A title can be composed of multiple items, such as:
			// AI (Artificial Intelligence, 人工智能)
			// At most three items, one for zh/en/abbr each.
			// The sequence of items is determined by the order of appearance in the input string.
			var flag_chinese: boolean = false;
			var flag_english: boolean = false;
			var flag_abbreviation: boolean = false;
			for (var [entity, type] of namesWithType){
				if (type === 'abbreviation' && !flag_abbreviation){
					titleItems.push(entity);
					flag_abbreviation = true;
				} else if (type === 'chinese-name' && !flag_chinese) {
					titleItems.push(entity);
					flag_chinese = true;
				} else if (type === 'english-name' && !flag_english) {
					titleItems.push(entity);
					flag_english = true;
				}
			}
			var title: string = titleItems[0];
			if (titleItems.length > 1) title += ' ('+titleItems.slice(1).join(', ') +')';
			if (descriptions.length > 0) title += ' ('+descriptions[0]+')';
			var wiki_tag: string = convert_to_legal_tag(titleItems[0]);
			return { title: title, wiki_tag: wiki_tag, allEntities: namesWithType,  titleEntities: titleItems };
		}

		const {
			title, 
			wiki_tag,
			allEntities,
			titleEntities
		} = generate_wiki_title_and_wikiTag(namesWithType, descriptions);

		const folders = this.wikiLibrary.folders;
		const chosenFolder: TFolder = await suggester(this.app, folders.map(folder => folder.path), folders)

		this.wikiLibrary.addNewEntry(chosenFolder, title, aliases, tags);
	}

	async Command_CreateNewDisambiguationWikiEntry(){
		if (!this.wikiLibrary) error('Wiki library not initialized.');
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

		new Setting(containerEl)
			.setName('Setting #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.wikiFolder || '')
				.onChange(async (value) => {
					this.plugin.settings.wikiFolder = value;
					await this.plugin.saveSettings();
				}));
	}
}



