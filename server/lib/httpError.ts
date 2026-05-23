export class AppError extends Error {
  statusCode: number
  publicCode: string

  constructor(statusCode: number, publicCode: string, message: string) {
    super(message)
    this.statusCode = statusCode
    this.publicCode = publicCode
  }
}

export function toSafeError(error: unknown) {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      body: {
        success: false,
        error: error.publicCode,
        message: error.message,
      },
    }
  }

  return {
    statusCode: 500,
    body: {
      success: false,
      error: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : '服务暂时不可用，请稍后重试',
    },
  }
}
