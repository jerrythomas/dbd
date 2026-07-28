/**
 * Tests for packages/cli/src/github-source.js
 */
import { describe, it, expect } from 'vitest'
import { parseGitHubSource, isGitHubSource } from '../src/github-source.js'

describe('github-source', () => {
	describe('parseGitHubSource()', () => {
		it('parses owner/repo shorthand', () => {
			const result = parseGitHubSource('sensei-hq/daemon')
			expect(result).toEqual({
				owner: 'sensei-hq',
				repo: 'daemon',
				subpath: null,
				ref: 'HEAD'
			})
		})

		it('parses owner/repo/subpath shorthand', () => {
			const result = parseGitHubSource('sensei-hq/daemon/database')
			expect(result).toEqual({
				owner: 'sensei-hq',
				repo: 'daemon',
				subpath: 'database',
				ref: 'HEAD'
			})
		})

		it('parses owner/repo/deep/subpath', () => {
			const result = parseGitHubSource('sensei-hq/daemon/src/database/schema')
			expect(result).toEqual({
				owner: 'sensei-hq',
				repo: 'daemon',
				subpath: 'src/database/schema',
				ref: 'HEAD'
			})
		})

		it('parses owner/repo@ref', () => {
			const result = parseGitHubSource('sensei-hq/daemon@v2.1')
			expect(result).toEqual({
				owner: 'sensei-hq',
				repo: 'daemon',
				subpath: null,
				ref: 'v2.1'
			})
		})

		it('parses owner/repo/subpath@ref', () => {
			const result = parseGitHubSource('sensei-hq/daemon/database@main')
			expect(result).toEqual({
				owner: 'sensei-hq',
				repo: 'daemon',
				subpath: 'database',
				ref: 'main'
			})
		})

		it('parses full GitHub URL', () => {
			const result = parseGitHubSource('https://github.com/sensei-hq/daemon')
			expect(result).toEqual({
				owner: 'sensei-hq',
				repo: 'daemon',
				subpath: null,
				ref: 'HEAD'
			})
		})

		it('parses full GitHub URL with tree/branch/path', () => {
			const result = parseGitHubSource('https://github.com/sensei-hq/daemon/tree/main/database')
			expect(result).toEqual({
				owner: 'sensei-hq',
				repo: 'daemon',
				subpath: 'database',
				ref: 'main'
			})
		})

		it('parses GitHub URL with .git suffix', () => {
			const result = parseGitHubSource('https://github.com/sensei-hq/daemon.git')
			expect(result).toEqual({
				owner: 'sensei-hq',
				repo: 'daemon',
				subpath: null,
				ref: 'HEAD'
			})
		})

		it('throws for single segment', () => {
			expect(() => parseGitHubSource('daemon')).toThrow('Invalid GitHub source')
		})

		it('throws for invalid owner characters', () => {
			expect(() => parseGitHubSource('../evil/repo')).toThrow('Invalid owner')
		})

		it('throws for path traversal in subpath', () => {
			expect(() => parseGitHubSource('owner/repo/../../etc/passwd')).toThrow(
				'path traversal is not allowed'
			)
		})

		it('throws for special characters in repo', () => {
			expect(() => parseGitHubSource('owner/repo;rm -rf/')).toThrow('Invalid repo')
		})
	})

	describe('isGitHubSource()', () => {
		it('returns false for null/undefined/empty', () => {
			expect(isGitHubSource(null)).toBe(false)
			expect(isGitHubSource(undefined)).toBe(false)
			expect(isGitHubSource('')).toBe(false)
		})

		it('returns false for current directory', () => {
			expect(isGitHubSource('.')).toBe(false)
		})

		it('returns false for absolute paths', () => {
			expect(isGitHubSource('/usr/local/db')).toBe(false)
		})

		it('returns false for relative paths starting with dot', () => {
			expect(isGitHubSource('./my-project')).toBe(false)
			expect(isGitHubSource('../other-project')).toBe(false)
		})

		it('returns true for GitHub URLs', () => {
			expect(isGitHubSource('https://github.com/owner/repo')).toBe(true)
		})

		it('returns true for owner/repo format when path does not exist', () => {
			expect(isGitHubSource('sensei-hq/daemon/database')).toBe(true)
		})

		it('returns false for single segment (not a valid GitHub ref)', () => {
			expect(isGitHubSource('daemon')).toBe(false)
		})
	})
})
