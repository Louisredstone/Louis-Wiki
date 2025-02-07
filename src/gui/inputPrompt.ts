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

export async function inputPrompt(header: string, pre_description?: string, post_description?: string, placeholder?: string, value?: string): Promise<string|null>{
    // var return_value = null;
    // const modal = new InputPromptModal(this.app, async (value: string|null) => {return_value = value;}, header, pre_description, post_description, placeholder, value);
    // return return_value;
    return new Promise((resolve) => {
        const modal = new InputPromptModal(this.app, async (value: string | null) => {
            resolve(value); // 当用户输入完成后，调用resolve
        }, header, pre_description, post_description, placeholder, value);
        modal.open();
    });
}

class InputPromptModal extends Modal {
	private title: string;
	private pre_description?: string;
	private post_description?: string;
	private placeholder?: string;
    private value?: string;
	private return_callback: (value: string|null) => Promise<void>;

	constructor(app: App, return_callback: (value: string|null) => Promise<void>, title: string, pre_description?: string, post_description?: string, placeholder?: string, value?: string, ) {
		super(app);
		this.title = title;
		this.pre_description = pre_description;
		this.placeholder = placeholder;
		this.value = value;
        this.post_description = post_description;
		this.return_callback = return_callback;
    }

    async onOpen() {
        const {contentEl} = this;
        var {placeholder, value} = this;
        if (!placeholder) placeholder = "";
        if (!value) value = "";
        
        contentEl.createEl('h2', {text: this.title})
        if (this.pre_description){
            contentEl.createEl('p', {text: this.pre_description})
        }
        const inputEl = contentEl.createEl('input', {attr: {type: 'text', placeholder: placeholder, value: value}, cls: 'full-width-input'});
        if (this.post_description){
            contentEl.createEl('p', {text: this.post_description})
        }

        inputEl.addEventListener('keydown', async (event: KeyboardEvent) => {
            if (event.key === 'Enter') {
                event.stopPropagation();
                event.preventDefault(); // Don't delete this line. It prevents a weird bug.
                var str = inputEl.value.trim();
                await this.return_callback(str);
                this.close();
            } else if (event.key === 'Escape') {
                event.stopPropagation();
                event.preventDefault();
                await this.return_callback(null);
                this.close();
            }
        });
        inputEl.focus();
    }

    onClose() {
        console.log("Calling: AddFootNote.onClose()")
        const {contentEl} = this;
        contentEl.empty();
    }
}