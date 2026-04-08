/**
 * reporter.mjs -- Test result reporter for the FAM Docker E2E suite.
 *
 * Collects pass / fail / skip results per category and produces
 * structured JSON + markdown summary output.
 */

import { writeFileSync } from 'node:fs'

export class Reporter {
  constructor() {
    /** @type {{ category: string, test: string, status: 'pass'|'fail'|'skip', duration?: number, error?: string, reason?: string }[]} */
    this.results = []
    this.startTime = Date.now()
  }

  /**
   * Record a passing test.
   * @param {string} category
   * @param {string} testName
   * @param {number} durationMs
   */
  pass(category, testName, durationMs) {
    this.results.push({ category, test: testName, status: 'pass', duration: durationMs })
    console.log(`  PASS  ${testName} (${durationMs}ms)`)
  }

  /**
   * Record a failing test.
   * @param {string} category
   * @param {string} testName
   * @param {Error|string} error
   * @param {number} durationMs
   */
  fail(category, testName, error, durationMs = 0) {
    const message = error instanceof Error ? error.message : String(error)
    this.results.push({ category, test: testName, status: 'fail', duration: durationMs, error: message })
    console.log(`  FAIL  ${testName} (${durationMs}ms)`)
    console.log(`        ${message}`)
  }

  /**
   * Record a skipped test.
   * @param {string} category
   * @param {string} testName
   * @param {string} reason
   */
  skip(category, testName, reason) {
    this.results.push({ category, test: testName, status: 'skip', reason })
    console.log(`  SKIP  ${testName} -- ${reason}`)
  }

  /**
   * Return a structured report object.
   */
  toJSON() {
    const totalDuration = Date.now() - this.startTime
    const passed = this.results.filter(r => r.status === 'pass').length
    const failed = this.results.filter(r => r.status === 'fail').length
    const skipped = this.results.filter(r => r.status === 'skip').length

    // Group by category
    const categories = {}
    for (const r of this.results) {
      if (!categories[r.category]) categories[r.category] = []
      categories[r.category].push(r)
    }

    return {
      timestamp: new Date().toISOString(),
      node_version: process.version,
      duration_ms: totalDuration,
      summary: { total: this.results.length, passed, failed, skipped },
      categories,
    }
  }

  /**
   * Produce a markdown summary string.
   */
  toMarkdown() {
    const report = this.toJSON()
    const lines = []

    lines.push('# FAM Docker E2E Test Report')
    lines.push('')
    lines.push(`**Date:** ${report.timestamp}`)
    lines.push(`**Node:** ${report.node_version}`)
    lines.push(`**Duration:** ${(report.duration_ms / 1000).toFixed(1)}s`)
    lines.push('')
    lines.push(`| Metric | Count |`)
    lines.push(`|--------|-------|`)
    lines.push(`| Passed | ${report.summary.passed} |`)
    lines.push(`| Failed | ${report.summary.failed} |`)
    lines.push(`| Skipped | ${report.summary.skipped} |`)
    lines.push(`| **Total** | **${report.summary.total}** |`)
    lines.push('')

    // Per-category table
    lines.push('## Results by Category')
    lines.push('')
    lines.push('| Category | Test | Status | Duration |')
    lines.push('|----------|------|--------|----------|')

    for (const [category, tests] of Object.entries(report.categories)) {
      for (const t of tests) {
        const status = t.status === 'pass' ? 'PASS' : t.status === 'fail' ? 'FAIL' : 'SKIP'
        const dur = t.duration != null ? `${t.duration}ms` : '-'
        lines.push(`| ${category} | ${t.test} | ${status} | ${dur} |`)
      }
    }

    // Failures section
    const failures = this.results.filter(r => r.status === 'fail')
    if (failures.length > 0) {
      lines.push('')
      lines.push('## Failures')
      lines.push('')
      for (const f of failures) {
        lines.push(`### ${f.category} / ${f.test}`)
        lines.push('')
        lines.push('```')
        lines.push(f.error)
        lines.push('```')
        lines.push('')
      }
    }

    return lines.join('\n')
  }

  /**
   * Write JSON report to file, print markdown to stdout,
   * and set process.exitCode to 1 if any tests failed.
   * @param {string} outputPath
   */
  finalize(outputPath) {
    const report = this.toJSON()

    // Write JSON report
    writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf-8')

    // Print markdown to stdout
    console.log('\n' + this.toMarkdown())

    // Summary line
    const { passed, failed, skipped, total } = report.summary
    console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped (${total} total) in ${(report.duration_ms / 1000).toFixed(1)}s\n`)

    if (failed > 0) {
      process.exitCode = 1
    }
  }
}
