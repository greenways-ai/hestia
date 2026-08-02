# Publishing hestia.greenways.ai

The Hestia microsite is an Astro static build hosted independently on Netlify.
The browser recovery demo remains on GitHub Pages at
hestia-demo.greenways.ai; its signalling Worker and origin allowlist do not
change when this site is published.

## Build and preview

    cd site
    npm ci
    npm test
    npm run build

From the repository root, link the dedicated Netlify project and create a draft
deploy before publishing:

    npx netlify link --name hestia-greenways-ai
    npx netlify deploy
    npx netlify deploy --prod

The repository-level netlify.toml selects site/ as the build base and site/dist/
as the publish output.

## Custom domain

Add hestia.greenways.ai to the Netlify project, then create a DNS-only
Cloudflare CNAME named hestia pointing to the project's Netlify hostname. Wait
for Netlify to provision the certificate before checking HTTPS.

Do not alter the existing hestia-demo CNAME, signal.hestia-demo Worker custom
domain, or recovery configuration as part of this deployment.
