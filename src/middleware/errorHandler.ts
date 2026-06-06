import { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod/v4';
import { HttpError, logger } from '../utils';

interface ErrorBody {
  status: number;
  message: string;
  name: string;
}

const routerNotFound: RequestHandler = (_, _res, _next) => {
  throw new HttpError(404, 'Route not found');
};

const errorHandler = (err: Error, req: Request, res: Response<ErrorBody>, _: NextFunction) => {
  const loggerMsg = 'ErrorHandler';

  // Log error details
  console.error(`[ErrorHandler] ${err.name}: ${err.message}`);
  console.error(`[ErrorHandler] Stack:`, err.stack);
  console.error(`[ErrorHandler] Request:`, {
    method: req.method,
    url: req.url,
    params: req.params,
    query: req.query,
    body: req.body,
  });

  if (err instanceof HttpError) {
    logger.warn(err, loggerMsg);
    res.status(err.status).send({ status: err.status, message: err.message, name: err.name });
    return;
  } else if (err instanceof ZodError) {
    logger.warn(err, loggerMsg);
    res.status(400).send({ status: 400, message: 'Invalid request', name: 'ZodError' });
    return;
  }

  logger.error(err, loggerMsg);

  // في development mode، أرسل تفاصيل أكثر
  const isDevelopment = process.env.NODE_ENV === 'development';

  res.status(500).send({
    status: 500,
    message: isDevelopment ? err.message : 'Something went wrong',
    name: 'InternalServerError',
    ...(isDevelopment && { stack: err.stack, details: err.toString() }),
  });
};

export const errorHandlerMiddleware = [routerNotFound, errorHandler];
