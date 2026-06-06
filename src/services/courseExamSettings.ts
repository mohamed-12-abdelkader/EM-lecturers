export const buildValidationError = (message: string) => {
  const error: any = new Error(message);
  error.status = 400;
  return error;
};

export const toDateOrNull = (value: string | null | undefined, field: string) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw buildValidationError(`${field} must be a valid ISO date`);
  }
  return parsed;
};

export const toDateOrNullIfProvided = (value: string | null | undefined, field: string) => {
  if (value === undefined) {
    return undefined;
  }
  return toDateOrNull(value, field);
};

export const toNumberOrNullIfProvided = (value: number | null | undefined, field: string) => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw buildValidationError(`${field} must be a valid number`);
  }
  return parsed;
};

export const normalizeNonNegativeHours = (
  value: number | null | undefined,
  field: string,
  defaultValue = 0,
) => {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw buildValidationError(`${field} must be a non-negative number`);
  }
  return parsed;
};

export const normalizeNonNegativeHoursIfProvided = (
  value: number | null | undefined,
  field: string,
) => {
  if (value === undefined) {
    return undefined;
  }
  return normalizeNonNegativeHours(value, field);
};
