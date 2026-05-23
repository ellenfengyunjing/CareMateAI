import type { ErrorRequestHandler } from 'express'
import { toSafeError } from '../lib/httpError.js'

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const safeError = toSafeError(error)
  res.status(safeError.statusCode).json(safeError.body)
}
