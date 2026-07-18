# Folder Studio

A [Sine](https://github.com/CosmoCreeper/Sine) mod for [Zen Browser](https://zen-browser.app) that lets you fully customize tab folders — and brings folders outside the pinned area.

<p align="center">
  <img src="https://raw.githubusercontent.com/Hashjolly/folder-studio/main/assets/folders-visual.png" width="640" alt="Folder Studio preview">
</p>

## Features

- **Custom colors** — pick any color for a folder: a 2px border plus a softly tinted background, no longer limited to a preset palette.
- **Custom icons** — use one of the standard icons, or grab the favicon of any tab already inside the folder.
- **Folders outside pinned tabs** — native Firefox tab groups get the exact same look and controls as Zen folders, so you're no longer limited to the pinned area.
- **One consistent panel** for name, icon and color — reached the same way whether you're creating a group, right-clicking it, or clicking its icon.
- **Full context menu** on tab groups: personalize, ungroup, or delete — actions that were missing on native groups by default.

## Requirements

- Zen Browser (tested on 1.21.8b)
- [Sine](https://github.com/CosmoCreeper/Sine) installed
- `browser.tabs.groups.enabled` = `true` in `about:config` (on by default in recent Zen builds) for the "folders outside pinned tabs" part

## Install

Via Sine's Marketplace once published, or manually:

1. Copy this folder into `<profile>/chrome/sine-mods/FolderStudio`
2. Enable it in Sine's settings

## Usage

- **Zen folder (pinned):** right-click a folder → *Couleur du dossier…* / *Icône depuis un onglet…*
- **Tab group (outside pinned):** create one via right-click on a tab → *Move Tab to Group → New Group*. Click its icon for the full name/icon/color panel, or right-click it for the full action menu.

## License

MIT
