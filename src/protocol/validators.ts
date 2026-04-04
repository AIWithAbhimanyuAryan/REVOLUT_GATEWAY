import AjvModule from "ajv";
const Ajv = AjvModule.default ?? AjvModule;
import {
  ConnectParamsSchema,
  RequestFrameSchema,
  ResponseFrameSchema,
  EventFrameSchema,
  type ConnectParams,
  type RequestFrame,
  type ResponseFrame,
  type EventFrame,
} from "./frames.js";

const ajv = new Ajv({ allErrors: true, strict: false });

export const validateConnectParams = ajv.compile<ConnectParams>(ConnectParamsSchema);
export const validateRequestFrame = ajv.compile<RequestFrame>(RequestFrameSchema);
export const validateResponseFrame = ajv.compile<ResponseFrame>(ResponseFrameSchema);
export const validateEventFrame = ajv.compile<EventFrame>(EventFrameSchema);

export function formatValidationErrors(
  errors: import("ajv").ErrorObject[] | null | undefined,
): string {
  if (!errors?.length) return "unknown validation error";
  return errors
    .map((e) => {
      const path = e.instancePath || "root";
      return `${path}: ${e.message ?? "validation error"}`;
    })
    .join("; ");
}
