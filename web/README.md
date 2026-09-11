# MINIMA Resize Studio

Independent React + Tailwind implementation of the MINIMA batch image-resizing workspace. The interface follows `Engine/MINIMA_Resize_UI_UX_Discussion.md` and the reference mockups in `UI_UX_REFERENCE/`.

## Local development

```bash
npm install
npm run dev
```

The Vite development URL is `http://localhost:5173/project-m2/`.

## Production build

```bash
npm run build
```

Vite writes the static site to the repository-level `docs/` directory. GitHub Pages serves that directory from the `main` branch at:

`https://shishiba389.github.io/project-m2/`

There is no ChatGPT Sites, Vinext, Cloudflare Worker, authentication, database, or runtime dependency in this build.
