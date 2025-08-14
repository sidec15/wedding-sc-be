// lambdas/subscriptions-delete/src/handler.ts
import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { DynamoDBClient, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { ILogger, Logger, webUtils } from "@wedding/common";

// -------- Config --------
const conf = {
  db: {
    region: process.env.AWS_REGION ?? "eu-west-1",
    tables: {
      subscriptions: process.env.SUBSCRIPTIONS_TABLE ?? "photo_subscriptions",
    },
  },
};

const logger: ILogger = new Logger();
logger.silly("Config loaded", conf);

const ddb = new DynamoDBClient({ region: conf.db.region });

// -------- Helpers --------
type ParsedRequest = { photoId: string; email: string };

const parseAndValidateRequest = (event: any): ParsedRequest | null => {
  logger.debug("Parsing and validating request");

  if (!conf.db.tables.subscriptions) {
    logger.error("Configuration error: SUBSCRIPTIONS_TABLE is not set");
    return null;
  }

  const photoId = event.pathParameters?.photoId;
  const emailRaw = event.pathParameters?.email;

  if (!photoId) {
    logger.error("Validation failed: Missing photoId in path");
    return null;
  }
  if (!emailRaw) {
    logger.error("Validation failed: Missing email in path");
    return null;
  }

  // Decode `%40`, etc.
  let decodedEmail: string;
  try {
    decodedEmail = decodeURIComponent(emailRaw);
  } catch {
    logger.error("Validation failed: email path segment is not valid URL-encoding", { emailRaw });
    return null;
  }

  const email = decodedEmail.trim().toLowerCase();
  if (!email) {
    logger.error("Validation failed: email is empty after normalization");
    return null;
  }

  logger.info("Unsubscribe request validated", { photoId, email });
  return { photoId, email };
};

const deleteSubscription = async (photoId: string, email: string) => {
  const res = await ddb.send(
    new DeleteItemCommand({
      TableName: conf.db.tables.subscriptions!,
      Key: {
        photoId: { S: photoId },
        email: { S: email },
      },
      ReturnValues: "ALL_OLD", // tells us if it existed
    })
  );
  return { existed: !!res.Attributes };
};

// -------- Handler --------
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  logger.info("Received unsubscribe request", {
    pathParameters: event.pathParameters,
    requestId: event.requestContext?.requestId,
  });

  try {
    const req = parseAndValidateRequest(event);
    if (!req) {
      logger.error("Request validation failed — aborting unsubscribe");
      return webUtils.failure(400, "validation_failed", "Invalid or missing input");
    }

    const { photoId, email } = req;
    const { existed } = await deleteSubscription(photoId, email);

    logger.info("Unsubscribe completed", { photoId, email, existed });

    // Idempotent success
    return webUtils.success(200, {
      photoId,
      email,
      unsubscribed: true,
      existed,
    });
  } catch (err) {
    logger.error("Error unsubscribing", err);
    return webUtils.failure(500, "internal_service_error", "An unexpected error occurred");
  }
};
