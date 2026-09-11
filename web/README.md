# MINIMA Resize Studio

Independent React + Tailwind implementation of the MINIMA batch image-resizing workspace. The interface follows `Engine/MINIMA_Resize_UI_UX_Discussion.md` and the reference mockups in `UI_UX_REFERENCE/`.

## Local development

```bash
npm install
npm run dev
```

The Vite development URL is `http://localhost:5173/project-m2/`.

## Verify

```bash
npm run check
```

Type-checks, runs the assertions in `src/flow.ts`, then server-renders every
screen and overlay. Run it before publishing — a passing `tsc` and a
successful bundle do not prove a screen mounts.

## Production build

```bash
npm run build
```

Vite writes the static site to the repository-level `docs/` directory.

This build is published to two GitHub Pages project sites, and a project site
is served from `/<repo>/`, so the base path has to match the target:

| Target | Command | URL |
|---|---|---|
| `project-m2` (this repo, `main` + `/docs`) | `npm run build` | https://shishiba389.github.io/project-m2/ |
| `minima-resize` (build output only, `main` + root) | `BASE_PATH=minima-resize npm run build`, then copy `docs/` to that repo's root | https://shishiba389.github.io/minima-resize/ |

`BASE_PATH` takes the repo name with or without slashes. Pass it unslashed:
Git Bash on Windows rewrites a leading `/` into an absolute Windows path, so
`BASE_PATH=/minima-resize/` silently produces
`/Program Files/Git/minima-resize/`.

After publishing the mirror, **run `npm run build` again** so `docs/` goes back
to this repo's base. Building with the wrong base leaves the page blank:
`index.html` asks for `/<other-repo>/assets/...` and Pages answers 404.

There is no ChatGPT Sites, Vinext, Cloudflare Worker, authentication,
database, or runtime dependency in this build.

## Workflow

`design-system/minima-resize/pages/flow.md` is the wiring table: one screen
state, one Back rule, and what every button does. `src/flow.ts` holds the
logic it describes.
