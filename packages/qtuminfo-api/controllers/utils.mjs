export class ErrorResponse {
  constructor(logger) {
    this.logger = logger
  }

  notReady(ctx, percentage) {
    ctx.throw(503, `Server not yet ready. Sync percentage: ${percentage}`)
  }

  handleErrors(ctx, err) {
    if (err.status) {
      throw err
    } else if (err.code) {
      ctx.throw(500, `${err.message}. Code: ${err.code}`)
    } else {
      this.logger.error(err.stack)
      ctx.throw(500, err.message)
    }
  }
}
