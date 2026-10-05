# GitHub Pages build

This is the GitHub-ready version of the ALM7 & 5th iLS interactive abstract book.

Changes made for web hosting:
- `asset-data.js` no longer embeds duplicate base64 copies of assets and pages. It is intentionally a tiny empty object; `app.js` loads the existing files from `assets/` and `pages/` using relative paths.
- The bundled PDF is the compressed GitHub-ready PDF while preserving links/bookmarks/page size.
- Keep the directory structure unchanged when uploading to GitHub Pages.

Upload the contents of this folder into your desired GitHub Pages subfolder (for example `abstract-book/`).
