/**
 * utils/logger.ts — Structured logging for FAM.
 *
 * Uses pino for fast, JSON-native structured logging.
 * Log level is configurable via FAM_LOG_LEVEL env var.
 * Uses pino-pretty for human-readable output in development.
 */

import pino from 'pino'

const level = process.env.FAM_LOG_LEVEL ?? 'info'

const transport =
  process.env.NODE_ENV !== 'production'
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss',
          ignore: 'pid,hostname',
        },
      }
    : undefined

export const logger = pino({
  name: 'fam',
  level,
  transport,
})

export default logger
