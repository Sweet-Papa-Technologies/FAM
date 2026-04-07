#!/usr/bin/env node

// Graceful exit on Ctrl+C — prevent ugly stack traces
process.on('SIGINT', () => {
  console.log('')
  process.exit(0)
})

import { program } from './cli/index.js'
program.parse()
