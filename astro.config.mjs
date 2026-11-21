import { defineConfig } from 'astro/config';

// The site is a GitHub Pages "project site":
//   https://<USER>.github.io/<REPO>/
// If the repo is ever renamed, change REPO here and nothing else.
const USER = 'zenilea';
const REPO = 'research-digital-portfolio';

export default defineConfig({
  site: `https://${USER}.github.io`,
  base: `/${REPO}`,
  trailingSlash: 'always',
  build: {
    // One small stylesheet, inlined, so no page waits on a CSS request.
    inlineStylesheets: 'always',
  },
  devToolbar: { enabled: false },
});
