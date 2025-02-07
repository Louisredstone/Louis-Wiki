import { 
	App, 
	Editor, 
	MarkdownView, 
	Modal, 
	Notice, 
	Plugin, 
	PluginSettingTab, 
	Setting, 
	htmlToMarkdown
} from 'obsidian';

export function log(msg: string, duration = 0) {
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