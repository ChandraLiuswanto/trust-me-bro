# Document Extraction

Use when the fetched source is a PDF, scan, image or layout-dependent table. Fetching the file and extracting its meaning are separate acceptance gates.

## Choose the extraction path

| Input | First path | Check before accepting |
|---|---|---|
| PDF with usable embedded text | Existing PDF text/layout parser | Reading order, missing glyphs, columns, headers and page boundaries |
| Image-only or unusable text layer | OCR with appropriate language and rotation/deskew | Character substitutions, decimal separators, page completeness |
| Tables | Layout-aware table extraction preserving rows, columns and spans | Repeated headers, merged cells, multi-page continuation, units |
| Mixed/scanned document | Route page by page; use vision/model extraction only where needed | Evidence location and agreement with the actual page |

Inspect a representative page first. OCR on every PDF adds cost and can degrade good embedded text. A text layer may itself be poor OCR: selectable text does not prove accuracy. Reuse installed parsers before adding a new framework.

## Evidence contract

For each extracted field retain source URL, retrieval time, content hash, document/page identifier, quoted source span or bounding box, raw value, normalized value and extractor version. Store only what the approved purpose needs; restrict and expire raw documents containing personal data.

Keep original bytes where authorized and useful for replay. Treat files as untrusted: limit download size, page count, decompression, memory and processing time; sandbox parsers and disable active content or external-resource fetching. A document link is subject to the same URL/redirect controls as a web page.

## Validate meaning, not only JSON

- Specify field types, units, currency, locale, date interpretation and allowed nulls before extraction.
- Preserve table relationships. Flattening `quantity | unit price | total` into unrelated text destroys the check you need.
- Verify numeric identities where applicable: line sums, subtotals, tax and grand total, with explicit rounding tolerance. Use decimal arithmetic for money.
- Check that a returned value occurs in its cited evidence and belongs to the correct label, row and entity. A plausible number in a valid schema can still be invented or copied from the wrong cell.
- Compare a second extraction path on ambiguous/high-impact fields. Agreement is corroboration, not proof: both paths may share the same bad OCR or layout assumption.
- Route unresolved discrepancies to review. Model self-confidence and OCR confidence are routing signals, not calibrated probabilities of correctness.

## Regression fixtures and acceptance

Use a small authorized or synthetic fixture set covering selectable text, a rotated scan, a multi-page table, missing fields, a decimal-comma amount and an ambiguous total. Define expected values and evidence locations by inspection. Measure field accuracy and review rate separately from file-download success; report unsupported pages rather than silently dropping them.

## Common mistakes

- Sending a login HTML response to a PDF parser because the URL ends in `.pdf`.
- Treating OCR reading order as table structure.
- Letting a model compute a missing amount and presenting it as extracted evidence.
- Averaging confidence across fields so a wrong account number hides behind correct headings.
- Assuming two agreeing parsers make human review unnecessary.

See [llm-extraction.md](llm-extraction.md) for model input/output validation and [production.md](production.md) for secure fetching and persistence gates.
