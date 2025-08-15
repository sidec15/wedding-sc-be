import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import {
  ILogger,
  Logger,
} from "@wedding/common";
import * as webUtils from "@wedding/common/dist/utils/web.utils";

const conf = {
  db: {
    region: process.env.MY_AWS_REGION,
    tables: {
      subscriptions: process.env.SUBSCRIPTIONS_TABLE,
    },
  },
};

const ddb = new DynamoDBClient({});
const SUBSCRIPTIONS_TABLE = conf.db.tables.subscriptions;

const logger: ILogger = new Logger();

interface CreateSubscriptionRequest {
  photoId: string;
  email: string;
}

const parseAndValidateRequest = (
  event: any
): CreateSubscriptionRequest | null => {
  logger.debug("Parsing and validating request");

  const photoId = event.pathParameters?.photoId;
  if (!photoId) {
    logger.error("Validation failed: Missing photoId in path parameters");
    return null;
  }

  if (!event.body) {
    logger.error("Validation failed: Missing request body");
    return null;
  }

  let body;
  try {
    body = JSON.parse(event.body);
    logger.debug("Parsed request body", { body });
  } catch {
    logger.error("Validation failed: Invalid JSON in request body");
    return null;
  }

  const email = webUtils.validateEmail(body.email);
  if (!email) {
    logger.error("Validation failed: Invalid email format", { email: body.email });
    return null;
  }

  logger.info("Request validated successfully", { photoId, email });
  return { email, photoId };
};

const putSubscription = async (
  req: CreateSubscriptionRequest
): Promise<void> => {
  logger.info("Storing subscription in DynamoDB", {
    table: SUBSCRIPTIONS_TABLE,
    photoId: req.photoId,
    email: req.email,
  });

  await ddb.send(
    new PutItemCommand({
      TableName: SUBSCRIPTIONS_TABLE,
      Item: {
        photoId: { S: req.photoId },
        email: { S: req.email.toLowerCase() }, // Always lowercase for SK
      },
      ConditionExpression:
        "attribute_not_exists(photoId) AND attribute_not_exists(email)",
    })
  );

  logger.info("Subscription successfully stored");
};

// ---------- Lambda Handler ----------
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  logger.info("Received request to create subscription", {
    pathParameters: event.pathParameters,
    requestId: event.requestContext?.requestId,
  });

  try {
    const req = parseAndValidateRequest(event);
    if (!req) {
      logger.error(
        "Request validation failed — aborting subscription creation"
      );
      return webUtils.failure(
        400,
        "validation_failed",
        "Invalid or missing input"
      );
    }

    await putSubscription(req);

    logger.info("Subscription creation completed successfully");

    const result = webUtils.success(201, {});

    return result;
  } catch (err) {
    logger.error("Error creating comment", err);
    return webUtils.failure(
      500,
      "internal_service_error",
      "An unexpected error occurred"
    );
  }
};
