# Obsidian Louis' Wiki Plugin

This is Louis' Wiki plugin for Obsidian (https://obsidian.md).

## Features

- Create a new wiki entry.
- You may choose a folder where the new wiki entry belongs to.
- Automatically update inheritTags when enabling the plugin. You may also manually do it by command 'Refresh wiki library'.

## Usage

1. Enable the plugin in Obsidian.
2. Set the WikiFolder in the plugin settings. ('Wiki' by default)
3. Do not create any notes manually in the WikiFolder. Use the commands provided by the plugin. (Unless you know what you are doing)
4. Enjoy.

### About Creating a New Wiki Entry

When you create a new wiki entry (by command 'Create new wiki entry'), your input will be parsed as aliases, tags, and description of the new entry. 

The aliases will be used as the title of the new entry. The aliases, tags, and description will be in the frontmatter.

A wiki-tag will be automatically generated based on the aliases (usually the first alias).

This wiki-tag is (should be) unique among all the wiki entries.

Moreover, a `#wiki-tag` alias will be automatically added to the aliases of frontmatter. By doing this, when you hover over `#wiki-tag` anywhere, it will show the wiki entry page. (Needs `Tag Wrangler` plugin)

E.g.:

Input: `Louis' Wiki Plugin, #ObsidianPlugin, //This is a wiki plugin for Obsidian.`
Frontmatter:
```
aliases: #Louis_Wiki_Plugin, Louis' Wiki Plugin
tags: Louis_Wiki_Plugin, ObsidianPlugin
description: This is a wiki plugin for Obsidian.
wiki-tag: Louis_Wiki_Plugin
```
And when you hover over `#Louis_Wiki_Plugin` anywhere, it will show this wiki entry page. (Needs `Tag Wrangler` plugin)

### About inheritTags

Inherit tags is the first line like `[Auto]: #tag1, #tag2`. (If there is no such line, it means current entry has no inherit tags.)

When you create a new wiki entry, use 'tags' in the frontmatter to specify strict subordinate relationships between entries. 

For example, entry 'Louis Wiki Plugin' has a tag 'Obsidian Plugin', and entry 'Obsidian Plugin' has a tag 'Obsidian'. Then, 'Louis Wiki Plugin' will inherit the tag 'Obsidian' from 'Obsidian Plugin'.

## TODO List

- Create a disambiguation page.
- Create a category page.
- If you created a new folder in WikiFolder, it should be automatically added to WikiLibrary.folders. (Now the plugin just refresh WikiLibrary.folders every time you create a new entry.)
- Merge nodes of a SCC (Strongly Connected Component).