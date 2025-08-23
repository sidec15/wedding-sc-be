// lambdas/subscriptions-delete/src/handler.ts
import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { DynamoDBClient, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { ILogger, Logger, webUtils } from "@wedding/common";

// -------- Config --------
const conf = {
  db: {
    region: process.env.MY_AWS_REGION ?? "eu-west-1",
    tables: {
      subscriptions: process.env.SUBSCRIPTIONS_TABLE ?? "photo_subscriptions",
    },
  },
  publicSite: process.env.PUBLIC_SITE ?? "https://matrimonio.chiaraesimone.it",
};

const logger: ILogger = new Logger();
const ddb = new DynamoDBClient({ region: conf.db.region });

// -------- Helpers --------
type ParsedRequest = { photoId: string; email: string };

const parseAndValidateRequest = (event: any): ParsedRequest | null => {
  const photoId = event.pathParameters?.photoId;
  const emailRaw = event.pathParameters?.email;

  if (!photoId || !emailRaw) return null;

  try {
    const email = decodeURIComponent(emailRaw).trim().toLowerCase();
    if (!email) return null;
    return { photoId, email };
  } catch {
    return null;
  }
};

const deleteSubscription = async (photoId: string, email: string) => {
  await ddb.send(
    new DeleteItemCommand({
      TableName: conf.db.tables.subscriptions!,
      Key: {
        photoId: { S: photoId },
        email: { S: email },
      },
    })
  );
};

const redirect = (location: string) => ({
  statusCode: 302,
  headers: {
    Location: location,
    "Cache-Control": "no-store",
  },
  body: "",
});

// -------- Handler --------
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const method = event.requestContext?.http?.method ?? "GET";
  logger.info("Received unsubscribe request", {
    method,
    pathParameters: event.pathParameters,
    requestId: event.requestContext?.requestId,
  });

  try {
    const req = parseAndValidateRequest(event);
    if (!req) {
      if (method === "GET") {
        return redirect(`${conf.publicSite}/unsubscribe?status=error&code=validation_failed`);
      }
      return webUtils.failure(400, "validation_failed", "Invalid or missing input");
    }

    const { photoId, email } = req;
    await deleteSubscription(photoId, email);

    if (method === "GET") {
      return redirect(
        `${conf.publicSite}/unsubscribe?status=ok&photo=${encodeURIComponent(photoId)}&email=${encodeURIComponent(email)}`
      );
    }

    // DELETE flow → JSON response
    return webUtils.success(200, {
      photoId,
      email,
      unsubscribed: true,
    });
  } catch (err) {
    logger.error("Error unsubscribing", err);

    if (method === "GET") {
      return redirect(`${conf.publicSite}/unsubscribe?status=error&code=internal_service_error`);
    }

    return webUtils.failure(500, "internal_service_error", "An unexpected error occurred");
  }
};
