---
name: ocbc-visual-design
description: Use when creating or reviewing OCBC Indonesia–inspired PowerPoint decks, HTML pages, dashboards, reports, charts, or other visuals, especially when matching BSA React or CODEC New.
---

# OCBC Indonesia visual design

Choose the visual family before choosing tokens. This is a working design reference, not an official OCBC brand manual. Approved brand assets and guidelines supplied for the job take precedence. No other skill, project checkout, remote font, or network lookup is required.

## Bundled assets

| Asset | Use |
|---|---|
| [Red OCBC logo and wordmark](assets/ocbc-red.png) | Light backgrounds. |
| [White OCBC logo and wordmark](assets/ocbc-white.png) | Dark backgrounds. |
| [Brand copy and logo sources](assets/brand-copy.md) | Display and legal names, alt text, and sample Indonesian and English labels. |

Resolve paths from this skill directory. Embed the PNG in a deck; for HTML, copy it into the output or embed it as a data URL for a single-file deliverable. Preserve the original colors and proportions. Use `alt="OCBC"` when the logo identifies the brand, or empty alt text when adjacent text already gives the name.

## Design tokens

| Target | Accent and surfaces | Typography |
|---|---|---|
| Public-site-inspired visual | OCBC Indonesia's public CSS uses `#A50212 → #DD141F` as a left-to-right gradient on primary buttons. Use it sparingly. For a flat red with white text, use `#A50212`. | Use Inter or a system sans as a fallback, not as a claim about official brand type. |
| Existing BSA React UI | `oklch(58% 0.18 28)` accent, `#FFFFFF` page, `#FAFAF9` surface, `#0C0C0C` text, `#ECECEA` border. | Plus Jakarta Sans; IBM Plex Mono for numeric detail. |
| Existing CODEC New UI | Same OKLCH app accent, `#F5F5F6` chrome, `#FFFFFF` content, `#18181B` ink, `#E8E8EA` border. `#E4002B` is the CODEC login red, not the app-wide accent or the observed public gradient. | Inter; JetBrains Mono for numeric detail. |
| New deck, report, infographic, or standalone HTML | Suggested synthesis: `#FFFFFF` canvas, `#FAFAF9` cards, `#18181B` titles, `#52525B` secondary text, `#E8E8EA` dividers, `#A50212` accessible accent on white. Reserve `#DD141F` for a small decorative accent or the public-site gradient. | Inter / Plus Jakarta Sans for web; Aptos or Arial for portable decks. Use tabular figures for tables and KPIs. |

## Apply by format

- **Deck:** Start with a 16:9 canvas. Give each slide one takeaway, a strong headline, and one main visual. Use 28–36 pt titles and about 18–22 pt body text. Keep data slides white; reserve a red cover detail or divider treatment for section changes. Prefer editable text and charts.
- **HTML / dashboard:** Use a neutral page, subtle card borders, a clear heading hierarchy, and one red primary action per decision area. Preserve live project theme variables rather than overriding them; follow the existing dark theme when present. Use real table headers, keyboard focus states, and responsive layouts.
- **Chart / infographic:** Highlight one focal series in red; keep comparisons neutral or use distinct hues for peer series. Label series directly where space allows. Use text, markers, or patterns as well as color. Keep brand accent separate from error and warning states. For Indonesian currency, prefer full values such as `Rp 1.250.000`.

**Example:** A board slide titled “More cases resolved this quarter” can use a white background, dark headline, and a red current-quarter bar against gray prior quarters. Label the bars with full values. The matching HTML version can reuse those color roles with a bordered card and an accessible data table.

## Before export

Check actual foreground/background pairs, including the light end of any gradient: aim for WCAG AA (4.5:1 for normal text, 3:1 for large text and essential non-text controls). Render the final deck or page and check clipping, charts, mobile layout where relevant, and font substitution. Use approved artwork as supplied. Use bundled artwork for drafts or internal mockups where permitted. Confirm approval and usage rights before publication; if approval is missing, omit the logo.

## Evidence and precedence

- [OCBC Indonesia homepage](https://www.ocbc.id/) and its [public stylesheet](https://cdn1.ocbc.id/asset/media/Base-Themes/OCBCID/Styles/normal/style.css?rev=-1?v=1): `.ocbc-btn--primary` shows the public-site gradient. A website treatment does not establish the full corporate palette.
- [OCBC Indonesia rebrand announcement](https://www.ocbc.id/en/tentang-ocbc/informasi/siaran-pers/2023/11/15/rebranding-ocbc) and [OCBC Group Annual Report: The Power of One Brand](https://www.ocbc.com/group/investors/annual-reports/2023-annual-report/the-power-of-one-brand.page): the current OCBC name and logo were introduced in Indonesia in November 2023. These sources do not specify the palette above.
- The BSA React and CODEC New rows are snapshots. Inside either app, preserve the live theme; otherwise use the values above. If a named font is unavailable, use a system sans or monospace as appropriate. Source links are provenance, not setup steps.
