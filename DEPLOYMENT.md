# GitHub Pages Deployment

This is the public-only Penrose Cup site repository. The Actions workflow is manual-only (`workflow_dispatch`) and deploys from `main`; pushes, pull requests and schedules do not publish.

## Initial setup

1. In repository Settings → Pages, set Build and deployment Source to GitHub Actions.
2. Review the public pages and data before each release.
3. Push reviewed changes to `main`. A push alone does not deploy.
4. In Actions, run **Publish Penrose Cup Statistics Hub** on `main` to publish.

## Local artifact review

Run `python3 build_pages.py`. It creates `.pages-build/` using an explicit allowlist of the site pages, scripts, styles, JSON and images. The generated directory contains only the public website artifact.

## Manual data updates

Race Director data is not synchronized by this repository. When an update is requested, prepare and review the public statistics locally, update the public files in this source tree, push the reviewed changes, then manually run the Pages workflow. No data refresh or deployment happens automatically.
