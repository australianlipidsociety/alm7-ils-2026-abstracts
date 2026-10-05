ALM7 & 5th iLS Interactive Book of Abstracts - V97

Built directly from V95.

Changes:
- Plenary & Keynote, Oral Presentations, Lightning Talks / Rapid Fire, and Poster Presentations divider pages have been natively re-rendered at 1785 x 2526 (3x) using the established divider layout.
- The new high-resolution divider images are embedded into asset-data.js, so the interactive book actually loads the updated pages.
- The same divider pages are updated in the PDF.
- Sponsors PDF update from V95 is retained.


V98 updates:
- Reduced all divider-page titles slightly so Oral and Poster no longer touch the page edge.
- Rebuilt the PDF directly from the current page set so the linked PDF now matches the interactive sponsors page and updated divider pages.
- asset-data.js reset to local-file loading so the interactive book uses the current page PNGs.


V99 local canvas fix:
- Rebuilt asset-data.js with every asset and static page embedded as data URLs.
- This prevents file:// canvas tainting and the “Canvas export failed / toBlob” error when opening the unzipped booklet locally.
- Visuals and the PDF are unchanged from V98.


V100 final polish:
- Divider title accent rules moved lower for more breathing room.
- Divider descriptions reflowed with a consistent right margin.
- Interactive viewer background changed to a dark blue gradient for stronger contrast against the book pages.
- PDF rebuilt with one consistent 595 x 842 point page size throughout.
- PDF abstract pages regenerated from the latest snapshot bundled with this package.


V101 PDF link restoration:
- Preserved the uniform 595 x 842 point page sizing.
- Restored internal PDF navigation links on the main contents, oral, Rapid Fire, poster contents and author index page references.
- Added PDF bookmarks for major sections.
- Interactive booklet visuals and behaviour are unchanged.

V102: bundled PDF is rendered directly from the same canvas pages as the interactive booklet, using the supplied current spreadsheet snapshot. Internal contents/index links are preserved.
