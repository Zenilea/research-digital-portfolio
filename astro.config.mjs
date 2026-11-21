import { defineConfig } from 'astro/config';
import { SITE, BASE } from './site.config.mjs';

// The site is a GitHub Pages "project site":
//   https://<USER>.github.io/<REPO>/
// The user and repo names are set once, in site.config.mjs.
export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: 'always',
  build: {
    // One small stylesheet, inlined, so no page waits on a CSS request.
    inlineStylesheets: 'always',
  },
  devToolbar: { enabled: false },
});
