// ==UserScript==
// @name         Folder Studio
// @description  Custom colors and icons for Zen folders, and folder-style native tab groups outside pinned tabs.
// @version      1.0.1
// @author       hashj
// @grant        none
// ==/UserScript==

(function () {
  if (window.__folderStudioInitialized) return;
  window.__folderStudioInitialized = true;

  // Deprecated storage: favicon data-URIs pushed folder-studio.native-icons
  // well past Firefox's "don't put this much data in a pref" threshold
  // (logged its own console warning). Kept only as a one-time migration
  // source into an external JSON file, which has no such size concern.
  const PREF_COLORS = "folder-studio.colors";
  const PREF_NATIVE_ICONS = "folder-studio.native-icons";
  const PREF_STYLE_GROUPS = "folder-studio.style-tab-groups";
  const DATA_FILE = PathUtils.join(PathUtils.profileDir, "folder-studio-data.json");

  const DEFAULT_SWATCHES = [
    "#f28b82", "#fbbc04", "#fff475", "#ccff90",
    "#a7ffeb", "#cbf0f8", "#aecbfa", "#d7aefb",
    "#fdcfe8", "#e6c9a8", "#e8eaed", "#81c995",
  ];

  function readJSONPref(name) {
    try {
      return JSON.parse(Services.prefs.getStringPref(name, "{}")) || {};
    } catch {
      return {};
    }
  }

  async function readDataFile() {
    try {
      return JSON.parse(await IOUtils.readUTF8(DATA_FILE));
    } catch {
      // No file yet - either a fresh install, or an upgrade from the old
      // pref-based storage. Migrate whatever is in the old prefs (if any)
      // and clear them so the size warning can't recur.
      const colors = readJSONPref(PREF_COLORS);
      const nativeIcons = readJSONPref(PREF_NATIVE_ICONS);
      const data = { colors, nativeIcons };
      if (Object.keys(colors).length || Object.keys(nativeIcons).length) {
        await writeDataFile(data);
        Services.prefs.clearUserPref(PREF_COLORS);
        Services.prefs.clearUserPref(PREF_NATIVE_ICONS);
      }
      return data;
    }
  }

  async function writeDataFile(data) {
    try {
      await IOUtils.writeUTF8(DATA_FILE, JSON.stringify(data));
    } catch (e) {
      console.error("[FolderStudio] Failed to write data file", e);
    }
  }

  class FolderStudioManager {
    #colors;
    #nativeIcons;
    #colorPanel;
    #iconPanel;
    #tabGroupMenu;
    #dragImageEl = null;
    #currentFolderMenuTarget = null;
    #mutationObserver = null;

    async init() {
      const data = await readDataFile();
      this.#colors = data.colors || {};
      this.#nativeIcons = data.nativeIcons || {};

      this.#buildColorPanel();
      this.#buildIconPanel();
      this.#buildTabGroupMenu();
      this.#extendZenFolderMenu();
      this.#bindGlobalEvents();

      this.applyAll();
    }

    get #styleNativeGroups() {
      return Services.prefs.getBoolPref(PREF_STYLE_GROUPS, true);
    }

    // ---------- persistence ----------

    #persistColor(id, hex) {
      if (hex) {
        this.#colors[id] = hex;
      } else {
        delete this.#colors[id];
      }
      this.#saveData();
    }

    #persistNativeIcon(id, iconURL) {
      if (iconURL) {
        this.#nativeIcons[id] = iconURL;
      } else {
        delete this.#nativeIcons[id];
      }
      this.#saveData();
    }

    #saveData() {
      // Fire-and-forget: called from synchronous UI event handlers, and a
      // write failure is already logged inside writeDataFile itself.
      writeDataFile({ colors: this.#colors, nativeIcons: this.#nativeIcons });
    }

    // ---------- applying state to DOM ----------

    applyAll() {
      if (!window.gBrowser) return;
      for (const group of gBrowser.tabGroups) {
        this.#applyToGroup(group);
      }
    }

    #applyToGroup(group) {
      if (!group?.id) return;
      // Skip the transient off-screen clone Zen builds for the drag preview
      // (ZenDragAndDrop.js sets drag-image="true" on it) - touching it here
      // races with setDragImage()'s snapshot and causes the preview to
      // flash at the wrong position before settling under the cursor.
      if (group.hasAttribute("drag-image")) return;

      const storedColor = this.#colors[group.id];
      if (storedColor) {
        this.#setColor(group, storedColor, /* persist */ false);
      }

      if (!group.isZenFolder) {
        this.#setupNativeGroup(group);
      }
    }

    #setColor(group, hex, persist = true) {
      if (hex) {
        group.style.setProperty("--fs-color", hex);
        group.setAttribute("data-fs-color", "");
      } else {
        group.style.removeProperty("--fs-color");
        group.removeAttribute("data-fs-color");
      }
      if (persist) this.#persistColor(group.id, hex);
    }

    #setupNativeGroup(group) {
      if (this.#styleNativeGroups) {
        group.setAttribute("data-fs-folder", "");
      } else {
        group.removeAttribute("data-fs-folder");
      }

      const labelContainer = group.querySelector(":scope > .tab-group-label-container");
      if (!labelContainer) return;

      // The native markup is a <vbox pack="center">: the XUL box alignment
      // can win over a plain CSS override, so flip it explicitly too.
      if (labelContainer.getAttribute("pack") !== "start") {
        labelContainer.setAttribute("pack", "start");
      }

      let icon = labelContainer.querySelector(":scope > .fs-group-icon");
      if (!icon) {
        icon = document.createElementNS("http://www.w3.org/1999/xhtml", "img");
        icon.className = "fs-group-icon";
        icon.setAttribute("role", "button");
        labelContainer.prepend(icon);
        icon.addEventListener("click", (event) => {
          event.stopPropagation();
          this.#openIconPanel(icon, group);
        });
        // Native (non-zen) tab-groups have no context menu of their own.
        // Right-click used to open Firefox's native rename/color modal
        // (native preset palette, inconsistent with our custom colors) -
        // give it a real menu instead: our personalization panel plus the
        // native actions (ungroup, delete) that modal also offered.
        labelContainer.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.#tabGroupMenu._group = group;
          this.#tabGroupMenu.openPopupAtScreen(event.screenX, event.screenY, true);
        });
      }

      const storedIcon = this.#nativeIcons[group.id];
      if (storedIcon && icon.getAttribute("src") !== storedIcon) {
        icon.setAttribute("src", storedIcon);
      }
    }

    // ---------- zen-folder context menu ----------

    #extendZenFolderMenu() {
      const popup = document.getElementById("zenFolderActions");
      const changeIconItem = document.getElementById("context_zenFolderChangeIcon");
      if (!popup || !changeIconItem) {
        console.warn("[FolderStudio] zenFolderActions popup not found, skipping menu injection.");
        return;
      }

      const colorItem = document.createXULElement("menuitem");
      colorItem.id = "context_fsChangeColor";
      colorItem.setAttribute("label", "Couleur du dossier…");
      changeIconItem.after(colorItem);

      const iconFromTabItem = document.createXULElement("menuitem");
      iconFromTabItem.id = "context_fsIconFromTab";
      iconFromTabItem.setAttribute("label", "Icône depuis un onglet…");
      colorItem.after(iconFromTabItem);

      popup.addEventListener("popupshowing", (event) => {
        const trigger = event.target.triggerNode || document.popupNode;
        this.#currentFolderMenuTarget = trigger?.closest?.("zen-folder") ?? null;
      });

      popup.addEventListener("command", (event) => {
        const folder = this.#currentFolderMenuTarget;
        if (!folder) return;
        // Anchor to the folder's own (persistent) icon element, not the
        // menuitem: the menuitem's popup is already closing by the time
        // openPopup() runs, so anchoring to it silently fails to show.
        const anchor = folder.icon || folder;
        if (event.target.id === "context_fsChangeColor") {
          setTimeout(() => this.#openColorPanel(anchor, folder), 0);
        } else if (event.target.id === "context_fsIconFromTab") {
          setTimeout(() => this.#openIconPanel(anchor, folder), 0);
        }
      });
    }

    // ---------- native tab-group context menu ----------
    // Mirrors zenFolderActions: full actions (not just our custom ones), but
    // driven entirely by our panel for name/icon/color so there is only one
    // color system in reach of right-click, matching what creation opens.

    #buildTabGroupMenu() {
      const menu = document.createXULElement("menupopup");
      menu.id = "fs-tabgroup-actions";

      const editItem = document.createXULElement("menuitem");
      editItem.setAttribute("label", "Nom, icône et couleur…");
      editItem.addEventListener("command", () => {
        const group = menu._group;
        if (!group) return;
        const labelContainer = group.querySelector(":scope > .tab-group-label-container");
        const icon = labelContainer?.querySelector(":scope > .fs-group-icon");
        setTimeout(() => this.#openIconPanel(icon || labelContainer || group, group), 0);
      });

      const sep = document.createXULElement("menuseparator");

      const ungroupItem = document.createXULElement("menuitem");
      ungroupItem.setAttribute("label", "Dissocier les onglets");
      ungroupItem.addEventListener("command", () => {
        const group = menu._group;
        if (!group) return;
        // tabsAndSplitViews came back empty for a real 2-tab group last
        // round (Zen's vertical-sidebar restructuring likely doesn't match
        // what that getter expects) - use the plain, well-known .tabs list
        // and gBrowser.ungroupTab() directly instead of the native
        // ungroupTabs() helper.
        const tabs = [...(group.tabs || [])];
        for (const tab of tabs) {
          try {
            gBrowser.ungroupTab(tab);
          } catch (e) {
            console.error("[FolderStudio] ungroupTab failed", e);
          }
        }
      });

      const deleteItem = document.createXULElement("menuitem");
      deleteItem.setAttribute("label", "Supprimer le groupe");
      deleteItem.addEventListener("command", () => {
        // Mirrors the native "Delete group" button: saves it to the
        // recently-closed tab groups list, then removes it.
        menu._group?.saveAndClose?.({ isUserTriggered: true });
      });

      menu.append(editItem, sep, ungroupItem, deleteItem);
      (document.getElementById("mainPopupSet") || document.documentElement).appendChild(menu);
      this.#tabGroupMenu = menu;
    }

    // ---------- color panel ----------

    #buildColorPanel() {
      const panel = document.createXULElement("panel");
      panel.id = "fs-color-panel";
      panel.setAttribute("type", "arrow");
      panel.setAttribute("noautofocus", "true");
      panel.className = "panel-no-padding";

      const box = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
      box.style.cssText = "padding:12px;display:flex;flex-direction:column;gap:10px;min-width:220px;";

      const swatchRow = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
      swatchRow.style.cssText = "display:grid;grid-template-columns:repeat(6,1fr);gap:6px;";
      for (const hex of DEFAULT_SWATCHES) {
        const swatch = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
        swatch.style.cssText = `width:22px;height:22px;border-radius:50%;background:${hex};cursor:pointer;border:1px solid color-mix(in srgb, ${hex} 60%, black);`;
        swatch.addEventListener("click", () => {
          if (panel._group) this.#setColor(panel._group, hex);
        });
        swatchRow.appendChild(swatch);
      }

      const customRow = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
      customRow.style.cssText = "display:flex;align-items:center;gap:8px;";

      const colorInput = document.createElementNS("http://www.w3.org/1999/xhtml", "input");
      colorInput.type = "color";
      colorInput.id = "fs-color-input";
      colorInput.style.cssText = "width:36px;height:26px;padding:0;border:none;background:none;cursor:pointer;";
      colorInput.addEventListener("input", () => {
        if (panel._group) this.#setColor(panel._group, colorInput.value);
      });

      const resetBtn = document.createElementNS("http://www.w3.org/1999/xhtml", "button");
      resetBtn.textContent = "Réinitialiser";
      resetBtn.style.cssText = "flex:1;";
      resetBtn.addEventListener("click", () => {
        if (panel._group) this.#setColor(panel._group, null);
      });

      customRow.append(colorInput, resetBtn);
      box.append(swatchRow, customRow);
      panel.appendChild(box);

      (document.getElementById("mainPopupSet") || document.documentElement).appendChild(panel);
      this.#colorPanel = panel;
    }

    #openColorPanel(anchorEl, group) {
      this.#colorPanel._group = group;
      const input = this.#colorPanel.querySelector("#fs-color-input");
      input.value = this.#colors[group.id] || "#8ab4f8";
      this.#colorPanel.openPopup(anchorEl, "after_start", 0, 0, false, false);
    }

    // ---------- icon panel ----------

    #buildIconPanel() {
      const panel = document.createXULElement("panel");
      panel.id = "fs-icon-panel";
      panel.setAttribute("type", "arrow");
      panel.setAttribute("noautofocus", "true");
      panel.className = "panel-no-padding";

      const box = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
      box.style.cssText = "padding:8px;display:flex;flex-direction:column;gap:4px;min-width:220px;max-height:320px;overflow-y:auto;";

      const nameInput = document.createElementNS("http://www.w3.org/1999/xhtml", "input");
      nameInput.type = "text";
      nameInput.id = "fs-icon-panel-name-input";
      nameInput.placeholder = "Nom du dossier";
      nameInput.style.cssText = "margin-bottom:6px;padding:4px 6px;";
      nameInput.addEventListener("change", () => {
        if (panel._group) panel._group.label = nameInput.value.trim() || "New Group";
      });
      nameInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") this.#iconPanel.hidePopup();
      });

      const standardBtn = document.createElementNS("http://www.w3.org/1999/xhtml", "button");
      standardBtn.textContent = "Icônes standards…";
      standardBtn.style.cssText = "margin-bottom:6px;";
      standardBtn.addEventListener("click", () => {
        const group = panel._group;
        this.#iconPanel.hidePopup();
        if (!window.gZenEmojiPicker || !group) return;
        gZenEmojiPicker.open(panel._anchor, {
          onlySvgIcons: true,
          allowNone: true,
          onSelect: (icon) => this.#setGroupIcon(group, icon),
        });
      });

      const list = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
      list.id = "fs-icon-tab-list";
      list.style.cssText = "display:flex;flex-direction:column;gap:2px;";

      const divider = document.createElementNS("http://www.w3.org/1999/xhtml", "hr");
      divider.style.cssText = "width:100%;border:none;border-top:1px solid color-mix(in srgb, currentColor 15%, transparent);margin:4px 0;";

      const swatchRow = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
      swatchRow.style.cssText = "display:grid;grid-template-columns:repeat(6,1fr);gap:6px;";
      for (const hex of DEFAULT_SWATCHES) {
        const swatch = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
        swatch.style.cssText = `width:20px;height:20px;border-radius:50%;background:${hex};cursor:pointer;border:1px solid color-mix(in srgb, ${hex} 60%, black);`;
        swatch.addEventListener("click", () => {
          if (panel._group) this.#setColor(panel._group, hex);
        });
        swatchRow.appendChild(swatch);
      }

      const customRow = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
      customRow.style.cssText = "display:flex;align-items:center;gap:8px;margin-top:6px;";

      const colorInput = document.createElementNS("http://www.w3.org/1999/xhtml", "input");
      colorInput.type = "color";
      colorInput.id = "fs-icon-panel-color-input";
      colorInput.style.cssText = "width:32px;height:24px;padding:0;border:none;background:none;cursor:pointer;";
      colorInput.addEventListener("input", () => {
        if (panel._group) this.#setColor(panel._group, colorInput.value);
      });

      const resetBtn = document.createElementNS("http://www.w3.org/1999/xhtml", "button");
      resetBtn.textContent = "Réinitialiser la couleur";
      resetBtn.style.cssText = "flex:1;";
      resetBtn.addEventListener("click", () => {
        if (panel._group) this.#setColor(panel._group, null);
      });

      customRow.append(colorInput, resetBtn);
      box.append(nameInput, standardBtn, list, divider, swatchRow, customRow);
      panel.appendChild(box);

      (document.getElementById("mainPopupSet") || document.documentElement).appendChild(panel);
      this.#iconPanel = panel;
    }

    #openIconPanel(anchorEl, group) {
      this.#iconPanel._group = group;
      this.#iconPanel._anchor = anchorEl;

      const nameInput = this.#iconPanel.querySelector("#fs-icon-panel-name-input");
      if (nameInput) nameInput.value = group.label || "";

      const colorInput = this.#iconPanel.querySelector("#fs-icon-panel-color-input");
      if (colorInput) colorInput.value = this.#colors[group.id] || "#8ab4f8";

      const list = this.#iconPanel.querySelector("#fs-icon-tab-list");
      list.textContent = "";

      const tabs = (group.allItemsRecursive ?? group.tabs ?? []).filter((item) => gBrowser.isTab?.(item));
      for (const tab of tabs) {
        const row = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
        row.style.cssText = "display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:6px;cursor:pointer;";
        row.addEventListener("mouseenter", () => (row.style.background = "var(--tab-hover-background-color, rgba(128,128,128,.15))"));
        row.addEventListener("mouseleave", () => (row.style.background = "transparent"));

        const img = document.createElementNS("http://www.w3.org/1999/xhtml", "img");
        img.style.cssText = "width:16px;height:16px;flex-shrink:0;";
        const iconURL = gBrowser.getIcon(tab) || "chrome://browser/skin/zen-icons/folder.svg";
        img.setAttribute("src", iconURL);

        const label = document.createElementNS("http://www.w3.org/1999/xhtml", "span");
        label.textContent = tab.label || tab.getAttribute("label") || "Onglet";
        label.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";

        row.append(img, label);
        row.addEventListener("click", () => {
          this.#setGroupIcon(group, iconURL);
          this.#iconPanel.hidePopup();
        });
        list.appendChild(row);
      }

      if (!tabs.length) {
        const empty = document.createElementNS("http://www.w3.org/1999/xhtml", "span");
        empty.textContent = "Aucun onglet dans ce dossier.";
        empty.style.cssText = "opacity:.7;padding:4px 6px;";
        list.appendChild(empty);
      }

      this.#iconPanel.openPopup(anchorEl, "after_start", 0, 0, false, false);
      if (nameInput) {
        this.#iconPanel.addEventListener("popupshown", () => {
          nameInput.focus();
          nameInput.select();
        }, { once: true });
      }
    }

    #setGroupIcon(group, iconURL) {
      if (group.isZenFolder) {
        if (window.gZenFolders?.setFolderUserIcon) {
          gZenFolders.setFolderUserIcon(group, iconURL ?? "");
        }
      } else {
        const icon = group.querySelector(":scope > .tab-group-label-container > .fs-group-icon");
        if (icon) icon.setAttribute("src", iconURL ?? "");
        this.#persistNativeIcon(group.id, iconURL);
      }
    }

    // ---------- global events ----------

    // ---------- custom drag image ----------
    // Self-contained: only inline styles, no dependency on our external
    // stylesheet or on whatever layout context Zen's own off-screen wrapper
    // provides, so it can't collapse the way Zen's clone did.

    #buildDragImage(group, rect) {
      this.#dragImageEl?.remove();

      const color = this.#colors[group.id]
        || getComputedStyle(document.documentElement).getPropertyValue("--zen-primary-color").trim()
        || "#7c93ff";
      const height = Math.min(Math.max(rect.height, 24), 36);

      const el = document.createElement("div");
      el.style.cssText = `
        position: fixed;
        top: -9999px;
        left: -9999px;
        width: ${Math.max(rect.width, 120)}px;
        height: ${height}px;
        box-sizing: border-box;
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 6px;
        padding-inline-start: 8px;
        border: 2px solid ${color};
        border-radius: 8px;
        background: color-mix(in srgb, ${color} 18%, var(--sidebar-background-color, white));
        color: var(--sidebar-text-color, black);
        font: menu;
        font-size: 12px;
        font-weight: 600;
        overflow: hidden;
        white-space: nowrap;
        z-index: 2147483647;
      `;

      const iconSrc = group.querySelector(":scope > .tab-group-label-container > .fs-group-icon")?.getAttribute("src");
      if (iconSrc) {
        const img = document.createElement("img");
        img.src = iconSrc;
        img.style.cssText = "width:14px;height:14px;border-radius:4px;flex-shrink:0;object-fit:cover;";
        el.appendChild(img);
      }

      const label = document.createElement("span");
      label.textContent = group.label || "";
      label.style.cssText = "overflow:hidden;text-overflow:ellipsis;";
      el.appendChild(label);

      document.documentElement.appendChild(el);
      this.#dragImageEl = el;
      return el;
    }

    #bindGlobalEvents() {
      const reapply = () => this.applyAll();
      for (const evt of ["TabGroupCreate", "FolderGrouped", "TabGrouped", "SSWindowStateReady"]) {
        window.addEventListener(evt, reapply);
      }

      this.#mutationObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE && (node.tagName === "zen-folder" || node.tagName === "tab-group")) {
              this.#applyToGroup(node);
            }
          }
        }
      });
      const container = document.getElementById("tabbrowser-arrowscrollbox") || gBrowser?.tabContainer;
      if (container) {
        this.#mutationObserver.observe(container, { childList: true, subtree: true });
      }

      Services.prefs.addObserver(PREF_STYLE_GROUPS, () => this.applyAll());

      // gBrowser's own "TabGroupCreateByUser" handler (bubble phase, on
      // window) opens Firefox's native rename+preset-color modal. Capture
      // it first and stopImmediatePropagation so that handler never runs -
      // our own icon/color panel opens instead, so a freshly-created group
      // is prompted with our custom colors, not the native preset palette.
      window.addEventListener(
        "TabGroupCreateByUser",
        (event) => {
          const group = event.target;
          if (group?.isZenFolder) return;
          event.stopImmediatePropagation();
          const labelContainer = group.querySelector(":scope > .tab-group-label-container");
          const icon = labelContainer?.querySelector(":scope > .fs-group-icon");
          setTimeout(() => this.#openIconPanel(icon || labelContainer || group, group), 0);
        },
        true
      );

      // Custom drag image for styled native groups.
      // tab-group[data-fs-folder] computes to display:contents (native
      // default for a plain tab-group), so it has no box of its own -
      // getBoundingClientRect() on the group is always 0x0. The real box
      // lives on its child .tab-group-label-container, measured at
      // mousedown (before any drag machinery can interfere). The override
      // is registered on both tabContainer and document since Zen's own
      // handler can stop propagation before it reaches document.
      let cachedGroup = null;
      let cachedRect = null;

      function labelContainerOf(group) {
        return group?.querySelector(":scope > .tab-group-label-container") || null;
      }

      document.addEventListener(
        "mousedown",
        (event) => {
          const group = event.target?.closest?.("tab-group[data-fs-folder]");
          const lc = labelContainerOf(group);
          if (!group || !lc || !lc.contains(event.target)) return;
          cachedGroup = group;
          cachedRect = lc.getBoundingClientRect();
        },
        true
      );

      const tabGroupDragOverride = (event) => {
        const group = event.target?.closest?.("tab-group[data-fs-folder]");
        const lc = labelContainerOf(group);
        if (!group || !lc || !lc.contains(event.target)) return;

        let rect = (cachedGroup === group) ? cachedRect : null;
        if (!rect || rect.width < 4) rect = lc.getBoundingClientRect();
        if (!rect || rect.width < 4) rect = { width: 220, height: 32 };

        const img = this.#buildDragImage(group, rect);
        try {
          event.dataTransfer.setDragImage(img, 16, rect.height / 2);
        } catch (e) {
          console.error("[FolderStudio] setDragImage failed", e);
        }
      };

      gBrowser?.tabContainer?.addEventListener("dragstart", tabGroupDragOverride);
      document.addEventListener("dragstart", tabGroupDragOverride);

      document.addEventListener("dragend", () => {
        this.#dragImageEl?.remove();
        this.#dragImageEl = null;
        cachedGroup = null;
        cachedRect = null;
      });

      // Zen folders already have their own dedicated "Move to folder" menu;
      // strip them from Firefox's native "Move Tab to Group" list so a
      // folder doesn't show up twice with two different behaviors.
      const moveToGroupPopup = document.getElementById("context_moveTabToGroupPopupMenu");
      moveToGroupPopup?.addEventListener("popupshowing", () => {
        queueMicrotask(() => {
          for (const item of moveToGroupPopup.querySelectorAll("menuitem[tab-group-id]")) {
            const group = gBrowser.getTabGroupById(item.getAttribute("tab-group-id"));
            if (group?.isZenFolder) item.hidden = true;
          }
        });
      });
    }
  }

  function bootstrap() {
    if (!window.gBrowser || !window.gZenWorkspaces) {
      document.addEventListener("DOMContentLoaded", () => bootstrap(), { once: true });
      return;
    }
    const manager = new FolderStudioManager();
    window.gFolderStudio = manager;
    manager.init().catch((e) => console.error("[FolderStudio] init failed", e));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    queueMicrotask(bootstrap);
  }
})();
