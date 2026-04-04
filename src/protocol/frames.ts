import { Type, type Static } from "@sinclair/typebox";

const NonEmptyString = Type.String({ minLength: 1 });

// ── Connect handshake ──────────────────────────────────────────────────

export const ConnectParamsSchema = Type.Object(
  {
    client: Type.Object(
      {
        id: NonEmptyString,
        version: NonEmptyString,
        platform: NonEmptyString,
      },
      { additionalProperties: false },
    ),
    auth: Type.Optional(
      Type.Object(
        { token: Type.Optional(Type.String()) },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const HelloOkSchema = Type.Object(
  {
    type: Type.Literal("hello-ok"),
    protocol: Type.Integer({ minimum: 1 }),
    server: Type.Object(
      {
        version: NonEmptyString,
        connId: NonEmptyString,
      },
      { additionalProperties: false },
    ),
    features: Type.Object(
      {
        methods: Type.Array(NonEmptyString),
        events: Type.Array(NonEmptyString),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

// ── Frame types (req / res / event) ────────────────────────────────────

export const ErrorShapeSchema = Type.Object(
  {
    code: NonEmptyString,
    message: NonEmptyString,
    details: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: false },
);

export const RequestFrameSchema = Type.Object(
  {
    type: Type.Literal("req"),
    id: NonEmptyString,
    method: NonEmptyString,
    params: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: false },
);

export const ResponseFrameSchema = Type.Object(
  {
    type: Type.Literal("res"),
    id: NonEmptyString,
    ok: Type.Boolean(),
    payload: Type.Optional(Type.Unknown()),
    error: Type.Optional(ErrorShapeSchema),
  },
  { additionalProperties: false },
);

export const EventFrameSchema = Type.Object(
  {
    type: Type.Literal("event"),
    event: NonEmptyString,
    payload: Type.Optional(Type.Unknown()),
    seq: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const GatewayFrameSchema = Type.Union(
  [RequestFrameSchema, ResponseFrameSchema, EventFrameSchema],
  { discriminator: "type" },
);

// ── Derived TypeScript types ───────────────────────────────────────────

export type ConnectParams = Static<typeof ConnectParamsSchema>;
export type HelloOk = Static<typeof HelloOkSchema>;
export type ErrorShape = Static<typeof ErrorShapeSchema>;
export type RequestFrame = Static<typeof RequestFrameSchema>;
export type ResponseFrame = Static<typeof ResponseFrameSchema>;
export type EventFrame = Static<typeof EventFrameSchema>;
export type GatewayFrame = Static<typeof GatewayFrameSchema>;
