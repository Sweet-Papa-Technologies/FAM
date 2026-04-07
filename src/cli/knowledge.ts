/**
 * cli/knowledge.ts — Knowledge store CLI commands.
 *
 * Subcommands: get, set, search, list, delete
 * Based on DESIGN.md Section 7.5 native tool extensions.
 */

import { Command } from 'commander'
import chalk from 'chalk'
import { KnowledgeStore } from '../knowledge/index.js'
import { KNOWLEDGE_DB } from '../utils/paths.js'

// ─── Command Registration ─────────────────────────────────────────

export function registerKnowledgeCommand(program: Command): void {
  const knowledge = program
    .command('knowledge')
    .description('Manage the shared knowledge store')

  // ── fam knowledge set <key> <value> ─────────────────────────────

  knowledge
    .command('set <key> <value>')
    .description('Store a knowledge entry')
    .option('--namespace <ns>', 'Namespace for the entry', 'global')
    .option('--tags <tags>', 'Comma-separated tags')
    .action((key: string, value: string, opts: { namespace: string; tags?: string }) => {
      const store = new KnowledgeStore(KNOWLEDGE_DB)
      try {
        const tags = opts.tags ? opts.tags.split(',').map((t: string) => t.trim()) : []
        store.set(key, value, { namespace: opts.namespace, tags, createdBy: 'cli' })
        console.log(chalk.green(`Stored: ${key}`))
      } finally {
        store.close()
      }
    })

  // ── fam knowledge get <key> ─────────────────────────────────────

  knowledge
    .command('get <key>')
    .description('Retrieve a knowledge entry')
    .option('--namespace <ns>', 'Namespace', 'global')
    .action((key: string, opts: { namespace: string }) => {
      const store = new KnowledgeStore(KNOWLEDGE_DB)
      try {
        const entry = store.get(key, opts.namespace)
        if (!entry) {
          console.log(chalk.yellow(`Not found: ${key}`))
          process.exit(1)
        }
        console.log(entry.value)
      } finally {
        store.close()
      }
    })

  // ── fam knowledge search <query> ────────────────────────────────

  knowledge
    .command('search <query>')
    .description('Search knowledge entries (full-text)')
    .option('--namespace <ns>', 'Filter by namespace')
    .option('--limit <n>', 'Max results', '20')
    .action((query: string, opts: { namespace?: string; limit: string }) => {
      const store = new KnowledgeStore(KNOWLEDGE_DB)
      try {
        const results = store.search(query, {
          namespace: opts.namespace,
          limit: parseInt(opts.limit, 10),
        })
        if (results.entries.length === 0) {
          console.log(chalk.yellow('No results found.'))
          return
        }
        console.log(chalk.dim(`Found ${results.total} result(s):\n`))
        for (const entry of results.entries) {
          console.log(chalk.bold(`[${entry.namespace}] ${entry.key}`))
          console.log(`  ${entry.value}`)
          if (entry.tags.length > 0) {
            console.log(chalk.dim(`  tags: ${entry.tags.join(', ')}`))
          }
          console.log()
        }
      } finally {
        store.close()
      }
    })

  // ── fam knowledge list ──────────────────────────────────────────

  knowledge
    .command('list')
    .description('List all knowledge entries')
    .option('--namespace <ns>', 'Filter by namespace')
    .option('--limit <n>', 'Max results', '50')
    .action((opts: { namespace?: string; limit: string }) => {
      const store = new KnowledgeStore(KNOWLEDGE_DB)
      try {
        const results = store.list({
          namespace: opts.namespace,
          limit: parseInt(opts.limit, 10),
        })
        if (results.entries.length === 0) {
          console.log(chalk.yellow('No knowledge entries found.'))
          return
        }
        console.log(chalk.dim(`${results.total} entries:\n`))
        for (const entry of results.entries) {
          const tags = entry.tags.length > 0 ? chalk.dim(` [${entry.tags.join(', ')}]`) : ''
          console.log(`  ${chalk.bold(entry.key)} (${entry.namespace})${tags}`)
          console.log(`    ${entry.value.substring(0, 100)}${entry.value.length > 100 ? '...' : ''}`)
        }
      } finally {
        store.close()
      }
    })

  // ── fam knowledge delete <key> ──────────────────────────────────

  knowledge
    .command('delete <key>')
    .description('Delete a knowledge entry')
    .option('--namespace <ns>', 'Namespace', 'global')
    .action((key: string, opts: { namespace: string }) => {
      const store = new KnowledgeStore(KNOWLEDGE_DB)
      try {
        const deleted = store.delete(key, opts.namespace)
        if (deleted) {
          console.log(chalk.green(`Deleted: ${key}`))
        } else {
          console.log(chalk.yellow(`Not found: ${key}`))
        }
      } finally {
        store.close()
      }
    })
}
