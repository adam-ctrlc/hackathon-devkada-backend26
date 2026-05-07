import { ZodError } from "zod";

const formatZodIssue = (issue) => {
  const path = issue.path.length ? issue.path.join(".") : "body";
  return `${path}: ${issue.message}`;
};

export const validateBody = (schema, body) => {
  const result = schema.safeParse(body ?? {});
  if (result.success) {
    return result.data;
  }

  const error = new Error(
    result.error.issues.map(formatZodIssue).join("; ") || "Invalid request",
  );
  error.status = 400;
  error.details = result.error.flatten();
  throw error;
};

export const isZodError = (error) => error instanceof ZodError;
