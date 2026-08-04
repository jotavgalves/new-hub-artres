from pathlib import Path

path = Path('scripts/catalog-v2/private-drive-catalog-indexer.mjs')
text = path.read_text(encoding='utf-8')

replacements = [
    (
        "const imageVersion = artwork.checksum || artwork.modifiedTime || '1';",
        "const imageVersion = artwork.modifiedTime || '1';",
        'public image version',
    ),
    (
        "    isShortcut: folder.isShortcut,\n    shortcutTargetId: folder.shortcutTargetId || undefined",
        "    isShortcut: folder.isShortcut",
        'folder shortcut target',
    ),
    (
        "    sourceDriveFileId: artwork.sourceDriveFileId,\n    shortcutTargetId: artwork.shortcutTargetId || undefined,\n",
        "",
        'artwork source identities',
    ),
    (
        "    sourceName: artwork.sourceName,\n",
        "",
        'artwork source name',
    ),
    (
        "    driveUrl: artwork.webViewLink,\n",
        "",
        'private Drive URL',
    ),
    (
        "    checksum: artwork.checksum,\n",
        "",
        'public checksum',
    ),
]

for old, new, label in replacements:
    if new and new in text and old not in text:
        continue
    if old not in text:
        raise SystemExit(f'PRIVATE_PAYLOAD_PATCH_TARGET_NOT_FOUND: {label}')
    text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
print('Private payload fields removed from accepted catalog rows.')
