# Folder Studio

A [Sine](https://github.com/CosmoCreeper/Sine) mod for [Zen Browser](https://zen-browser.app) that adds:

- **Couleur personnalisée** pour les dossiers (bordure 2px + fond légèrement teinté), via un petit sélecteur (palette + couleur libre) ouvert par clic droit sur un dossier.
- **Icône personnalisée** : soit une icône standard (réutilise le picker natif de Zen), soit le favicon d'un des onglets présents dans le dossier.
- **Dossiers hors zone épinglée** : les groupes d'onglets natifs de Firefox (créés via clic droit sur un onglet → "Déplacer vers un groupe → Nouveau groupe") sont habillés avec la même apparence que les dossiers Zen, et bénéficient du même système de couleur/icône.

## Prérequis

- Zen Browser (testé sur 1.21.8b).
- `browser.tabs.groups.enabled` = `true` dans `about:config` (activé par défaut sur les versions récentes) pour la partie "dossiers hors épinglés".
- [Sine](https://github.com/CosmoCreeper/Sine) installé.

## Installation

Voir la section "Installer/tester" dans la conversation de développement, ou une fois publié : Sine → Marketplace → rechercher "Folder Studio".

## Notes techniques

- Les dossiers Zen (`zen-folder`) sont toujours épinglés par construction (`get pinned()` renvoie `isZenFolder`, setter no-op côté navigateur) — ce mod ne tente pas de contourner cet invariant, il s'appuie sur les tab-groups natifs pour le cas "hors pinned".
- L'icône des `zen-folder` est appliquée via l'API native `gZenFolders.setFolderUserIcon()`, donc persistée automatiquement par la sauvegarde de session de Zen.
- La couleur des `zen-folder` et l'icône des tab-groups natifs ne sont pas persistées nativement par le navigateur : ce mod les stocke dans des préférences JSON (`folder-studio.colors`, `folder-studio.native-icons`) indexées par l'identifiant du groupe.
