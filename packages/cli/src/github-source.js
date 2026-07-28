/**
 * GitHub source support — download database design files from a GitHub repository.
 *
 * Supports shorthand (owner/repo/path) and full GitHub URLs.
 * Downloads via GitHub API tarball with optional local caching.
 *
 * Security: All user-supplied path segments (owner, repo, ref, subpath) are validated
 * against strict allowlists before use in filesystem operations. This is a CLI tool
 * where users already have full filesystem access.
 */
import {
	mkdtempSync,
	mkdirSync,
	existsSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'fs'
import { join } from 'path'
import { tmpdir, homedir } from 'os'
import { execFileSync } from 'child_process'

const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

// Only allow safe characters in GitHub path segments (alphanumeric, hyphen, underscore, dot)
const SAFE_SEGMENT = /^[a-zA-Z0-9._-]+$/
// Subpath segments: same chars plus forward slashes, no '..' traversal
const SAFE_SUBPATH = /^[a-zA-Z0-9._/-]+$/

/**
 * Validates a GitHub path segment against injection/traversal.
 * @param {string} value
 * @param {string} label
 */
function validateSegment(value, label) {
	if (!SAFE_SEGMENT.test(value) || value === '.' || value === '..') {
		throw new Error(
			`Invalid ${label}: "${value}" — only alphanumeric, hyphens, underscores, and dots are allowed`
		)
	}
}

/**
 * Validates a subpath has no traversal sequences.
 * @param {string} value
 */
function validateSubpath(value) {
	if (!SAFE_SUBPATH.test(value) || value.includes('..')) {
		throw new Error(`Invalid subpath: "${value}" — path traversal is not allowed`)
	}
}

/**
 * Parses a GitHub source string into validated components.
 *
 * Formats:
 *   owner/repo
 *   owner/repo/subpath
 *   owner/repo@ref
 *   owner/repo/subpath@ref
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/tree/branch/subpath
 *
 * @param {string} source
 * @returns {{ owner: string, repo: string, subpath: string|null, ref: string }}
 */
export function parseGitHubSource(source) {
	let owner, repo, ref, subpath

	const urlMatch = source.match(
		/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/([^/]+)(?:\/(.+))?)?$/
	)
	if (urlMatch) {
		owner = urlMatch[1]
		repo = urlMatch[2]
		ref = urlMatch[3] || 'HEAD'
		subpath = urlMatch[4] || null
	} else {
		ref = 'HEAD'
		let pathStr = source
		const atIdx = source.lastIndexOf('@')
		if (atIdx > 0) {
			ref = source.slice(atIdx + 1)
			pathStr = source.slice(0, atIdx)
		}

		const parts = pathStr.split('/')
		if (parts.length < 2) throw new Error(`Invalid GitHub source: "${source}"`)

		owner = parts[0]
		repo = parts[1]
		subpath = parts.length > 2 ? parts.slice(2).join('/') : null
	}

	validateSegment(owner, 'owner')
	validateSegment(repo, 'repo')
	validateSegment(ref, 'ref')
	if (subpath) validateSubpath(subpath)

	return { owner, repo, subpath, ref }
}

/**
 * Checks if a source string looks like a GitHub reference rather than a local path.
 *
 * @param {string} source
 * @returns {boolean}
 */
export function isGitHubSource(source) {
	if (!source || source === '.') return false
	if (source.startsWith('https://github.com/')) return true
	if (source.startsWith('/') || source.startsWith('.')) return false
	if (existsSync(source)) return false
	return source.split('/').length >= 2
}

/**
 * Returns the cache directory for a given GitHub source.
 * Respects XDG_CACHE_HOME if set.
 * All inputs are pre-validated by parseGitHubSource.
 */
function cacheDir(owner, repo, ref) {
	const base = process.env.XDG_CACHE_HOME || join(homedir(), '.cache')
	const key = `${owner}-${repo}-${ref}`
	return join(base, 'dbd', key)
}

/**
 * Checks whether a cached download is still fresh.
 */
function isCacheFresh(dir) {
	const metaFile = join(dir, '.dbd-cache-meta')
	if (!existsSync(metaFile)) return false
	try {
		const meta = JSON.parse(readFileSync(metaFile, 'utf-8'))
		return Date.now() - meta.timestamp < CACHE_TTL_MS
	} catch {
		return false
	}
}

/**
 * Downloads a GitHub tarball into a target directory.
 * Used by both cached and temp download paths.
 * All inputs are pre-validated by parseGitHubSource.
 */
function fetchTarball(owner, repo, ref, destDir) {
	const tarball = join(destDir, 'archive.tar.gz')
	const url = `https://api.github.com/repos/${owner}/${repo}/tarball/${ref}`
	const token = process.env.GITHUB_TOKEN

	const curlArgs = ['-sL', '-o', tarball, '-H', 'Accept: application/vnd.github+json']
	if (token) curlArgs.push('-H', `Authorization: Bearer ${token}`)
	curlArgs.push(url)

	try {
		execFileSync('curl', curlArgs, { stdio: 'pipe', timeout: 60_000 })
	} catch {
		throw new Error(
			`Failed to download from GitHub: ${owner}/${repo}@${ref}\n` +
				`Ensure the repository exists and is accessible.` +
				(token ? '' : ' For private repos, set GITHUB_TOKEN.')
		)
	}

	try {
		execFileSync('tar', ['xzf', tarball, '-C', destDir], { stdio: 'pipe', timeout: 30_000 })
	} catch {
		throw new Error(`Failed to extract archive from ${owner}/${repo}@${ref}`)
	}

	rmSync(tarball)
}

/**
 * Resolves the working directory inside an extracted tarball.
 * GitHub tarballs extract to a single directory like owner-repo-sha/.
 * Subpath is pre-validated by parseGitHubSource (no '..' traversal).
 */
function resolveWorkDir(baseDir, subpath, owner, repo) {
	const entries = readdirSync(baseDir).filter((e) => e !== '.dbd-cache-meta')
	if (entries.length === 0) {
		throw new Error(`Empty response from GitHub for ${owner}/${repo}`)
	}

	let workDir = join(baseDir, entries[0])

	if (subpath) {
		workDir = join(workDir, subpath)
		if (!existsSync(workDir)) {
			throw new Error(`Subfolder "${subpath}" not found in ${owner}/${repo}`)
		}
	}

	return workDir
}

/**
 * Downloads a GitHub repository to a temporary directory.
 * Returns workDir and a cleanup function that removes the temp files.
 *
 * @param {string} source - GitHub source string
 * @returns {{ workDir: string, cleanup: () => void }}
 */
export function downloadGitHubSource(source) {
	const { owner, repo, subpath, ref } = parseGitHubSource(source)
	const tmpDir = mkdtempSync(join(tmpdir(), 'dbd-'))

	const label = subpath ? `${owner}/${repo}/${subpath}` : `${owner}/${repo}`
	console.info(`Downloading from GitHub: ${label}${ref !== 'HEAD' ? ` (${ref})` : ''}`)

	try {
		fetchTarball(owner, repo, ref, tmpDir)
	} catch (err) {
		rmSync(tmpDir, { recursive: true, force: true })
		throw err
	}

	try {
		const workDir = resolveWorkDir(tmpDir, subpath, owner, repo)
		const cleanup = () => rmSync(tmpDir, { recursive: true, force: true })
		return { workDir, cleanup }
	} catch (err) {
		rmSync(tmpDir, { recursive: true, force: true })
		throw err
	}
}

/**
 * Downloads a GitHub repository with local caching.
 * Reuses a cached copy if it exists and is less than 1 hour old.
 * Returns workDir only (no cleanup — cache persists).
 *
 * @param {string} source - GitHub source string
 * @param {{ refresh?: boolean }} [opts]
 * @returns {string} workDir
 */
export function cachedGitHubSource(source, opts = {}) {
	const { owner, repo, subpath, ref } = parseGitHubSource(source)
	const dir = cacheDir(owner, repo, ref)
	const label = subpath ? `${owner}/${repo}/${subpath}` : `${owner}/${repo}`

	if (!opts.refresh && existsSync(dir) && isCacheFresh(dir)) {
		console.info(`Using cached source: ${label}`)
		return resolveWorkDir(dir, subpath, owner, repo)
	}

	// Clear stale cache and re-download
	if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
	mkdirSync(dir, { recursive: true })

	console.info(`Downloading from GitHub: ${label}${ref !== 'HEAD' ? ` (${ref})` : ''}`)

	try {
		fetchTarball(owner, repo, ref, dir)
		writeFileSync(join(dir, '.dbd-cache-meta'), JSON.stringify({ timestamp: Date.now() }))
	} catch (err) {
		rmSync(dir, { recursive: true, force: true })
		throw err
	}

	return resolveWorkDir(dir, subpath, owner, repo)
}
