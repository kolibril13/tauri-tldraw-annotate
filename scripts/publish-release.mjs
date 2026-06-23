// Publishes the built+notarized curate-draw.app into the jan-hendrik-mueller.de
// website as a versioned download, and regenerates the version manifest.
//
// Run as the second half of `bun run release` (after `tauri build --bundles app`).
// The manifest is derived entirely from the zips present in the public dir, so
// the list of downloadable versions stays consistent with what's on disk.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEBSITE_PUBLIC = '/Users/jan-hendrik/projects/jan-hendrik-mueller.de/public';
const APP_BUNDLE = join(repoRoot, 'src-tauri/target/release/bundle/macos/curate-draw.app');

const { version } = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8'));

// 1. Zip the notarized .app to a versioned filename (ditto keeps the stapled
//    notarization ticket and resource forks intact).
const versionedZip = join(WEBSITE_PUBLIC, `curate-draw-${version}.zip`);
console.log(`Zipping ${APP_BUNDLE} -> ${versionedZip}`);
execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', APP_BUNDLE, versionedZip]);

// 2. Refresh the unversioned "latest" alias (back-compat for any direct links).
copyFileSync(versionedZip, join(WEBSITE_PUBLIC, 'curate-draw.zip'));

// 3. Regenerate the manifest from every versioned zip present.
const semverDesc = (a, b) => {
	const pa = a.split('.').map(Number);
	const pb = b.split('.').map(Number);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pb[i] || 0) - (pa[i] || 0);
		if (d !== 0) return d;
	}
	return 0;
};

const versions = readdirSync(WEBSITE_PUBLIC)
	.map((file) => /^curate-draw-(\d+\.\d+\.\d+)\.zip$/.exec(file))
	.filter(Boolean)
	.map(([file, ver]) => {
		const { size, mtime } = statSync(join(WEBSITE_PUBLIC, file));
		return {
			version: ver,
			file,
			size: `${(size / 1_000_000).toFixed(1)} MB`,
			date: mtime.toISOString().slice(0, 10),
		};
	})
	.sort((a, b) => semverDesc(a.version, b.version));

const manifest = { latest: versions[0].version, versions };
writeFileSync(
	join(WEBSITE_PUBLIC, 'curate-draw-versions.json'),
	JSON.stringify(manifest, null, 2) + '\n',
);

console.log(`Published curate-draw ${version}. Manifest now lists: ${versions.map((v) => v.version).join(', ')}`);
