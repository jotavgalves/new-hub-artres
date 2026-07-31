from pathlib import Path

path = Path('functions/api/catalog-v2.js')
text = path.read_text(encoding='utf-8')

replacements = [
    (
        "  if (live === null) return indexed;\n  sortFolders(live);",
        "  if (!Array.isArray(live) || live.length === 0) return indexed;\n  sortFolders(live);",
        'theme fallback',
    ),
    (
        "  if (live === null) return indexed;\n\n  const cards = live.folders",
        "  if (!live || (!live.folders.length && !live.images.length)) return indexed;\n\n  const cards = live.folders",
        'product fallback',
    ),
    (
        "  if (live === null) return indexedItems.sort(sortItems);\n\n  const indexedById",
        "  if (!live || live.images.length === 0) return indexedItems.sort(sortItems);\n\n  const indexedById",
        'item fallback',
    ),
    (
        "  if (liveThemes === null) return sortSearchFolders(indexed);",
        "  if (!Array.isArray(liveThemes) || liveThemes.length === 0) return sortSearchFolders(indexed);",
        'search fallback',
    ),
    (
        "    key,\n    fields: 'id,name,mimeType,parents,trashed'",
        "    key,\n    supportsAllDrives: 'true',\n    fields: 'id,name,mimeType,parents,trashed'",
        'files.get shared drive flag',
    ),
    (
        "      key,\n      q: `'${folderId}' in parents and trashed = false`,",
        "      key,\n      supportsAllDrives: 'true',\n      includeItemsFromAllDrives: 'true',\n      q: `'${folderId}' in parents and trashed = false`,",
        'files.list shared drive flags',
    ),
]

for old, new, label in replacements:
    if old not in text:
        raise SystemExit(f'PATCH_TARGET_NOT_FOUND: {label}')
    text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
print('Panel Drive hotfix applied successfully.')
