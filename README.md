# rogiervanstraten.github.io

Personal site and blog. Astro + Tailwind, content is plain markdown with
frontmatter under `src/content/blog/`.

## Develop

```bash
npm install
npm run dev
```

## New post

Add a file to `src/content/blog/`:

```md
---
title: Post title
description: One-line summary.
date: 2026-07-05
---

Body in markdown.
```

## Deploy

Pushes to `master` build and deploy via GitHub Actions
(`.github/workflows/deploy.yml`) to GitHub Pages. Repo Settings → Pages →
Source must be set to "GitHub Actions".
