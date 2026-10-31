export interface FieldErrors {
  [field: string]: string[];
}

export abstract class AppError extends Error {
  public abstract readonly statusCode: number;
  public abstract readonly type: string;
  public readonly fieldErrors?: FieldErrors;

  constructor(message: string, fieldErrors?: FieldErrors) {
    super(message);
    this.name = this.constructor.name;
    this.fieldErrors = fieldErrors;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  public readonly statusCode = 400;
  public readonly type = 'https://brightloop.io/errors/validation-error';

  constructor(message = 'Validation failed', fieldErrors?: FieldErrors) {
    super(message, fieldErrors);
  }
}

export class UnauthorizedError extends AppError {
  public readonly statusCode = 401;
  public readonly type = 'https://brightloop.io/errors/unauthorized';

  constructor(message = 'Authentication required') {
    super(message);
  }
}

export class ForbiddenError extends AppError {
  public readonly statusCode = 403;
  public readonly type = 'https://brightloop.io/errors/forbidden';

  constructor(message = 'Access denied') {
    super(message);
  }
}

export class NotFoundError extends AppError {
  public readonly statusCode = 404;
  public readonly type = 'https://brightloop.io/errors/not-found';

  constructor(message = 'Requested resource not found') {
    super(message);
  }
}

export class ConflictError extends AppError {
  public readonly statusCode = 409;
  public readonly type = 'https://brightloop.io/errors/conflict';

  constructor(message = 'Resource conflict or optimistic lock failure', fieldErrors?: FieldErrors) {
    super(message, fieldErrors);
  }
}

export class UnprocessableEntityError extends AppError {
  public readonly statusCode = 422;
  public readonly type = 'https://brightloop.io/errors/unprocessable-entity';

  constructor(message = 'Unprocessable entity', fieldErrors?: FieldErrors) {
    super(message, fieldErrors);
  }
}

export class TooManyRequestsError extends AppError {
  public readonly statusCode = 429;
  public readonly type = 'https://brightloop.io/errors/too-many-requests';

  constructor(message = 'Rate limit exceeded. Please try again later.') {
    super(message);
  }
}
