import {
  APIGatewayProxyEventV2,
  APIGatewayProxyHandlerV2,
  Context,
} from "aws-lambda";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { ILogger, Logger, validateRecaptcha } from "@wedding/common";
import * as webUtils from "@wedding/common/dist/utils/web.utils";

const conf = {
  db: {
    region: process.env.MY_AWS_REGION || "eu-west-1",
    tables: {
      subscriptions: process.env.SUBSCRIPTIONS_TABLE!,
    },
  },
  use_recaptcha: process.env.USE_RECAPTCHA === "true",
  validatorFunctionName: process.env.CAPTCHA_VALIDATOR_FUNCTION_NAME,
};

const ddb = new DynamoDBClient({ region: conf.db.region });
const SUBSCRIPTIONS_TABLE = conf.db.tables.subscriptions;

const logger: ILogger = new Logger();
const lambdaClient = new LambdaClient({ region: conf.db.region });

interface CreateSubscriptionRequest {
  photoId: string;
  email: string;
  recaptchaToken?: string;
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

  let body: any;
  try {
    body = JSON.parse(event.body);
    logger.debug("Parsed request body", { body });
  } catch {
    logger.error("Validation failed: Invalid JSON in request body");
    return null;
  }

  const email = webUtils.validateEmail(body.email);
  if (!email) {
    logger.error("Validation failed: Invalid email format", {
      email: body.email,
    });
    return null;
  }

  logger.info("Request validated successfully", { photoId, email });
  return { email, photoId, recaptchaToken: body.recaptchaToken };
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
export const handler: APIGatewayProxyHandlerV2 = async (
  event: APIGatewayProxyEventV2,
  context: Context
) => {
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
        "Invalid or missing input",
        context.awsRequestId,
        event.requestContext.requestId
      );
    }

    // --- reCAPTCHA (simple boolean contract) ---
    if (conf.use_recaptcha) {
      if (!req.recaptchaToken) {
        logger.warn("Missing reCAPTCHA token");
        return webUtils.failure(
          400,
          "missing_recaptcha_token",
          "Missing reCAPTCHA token",
          context.awsRequestId,
          event.requestContext.requestId
        );
      }

      logger.info("Validating reCAPTCHA token via captcha-validator lambda");
      const result = await validateRecaptcha(
        req.recaptchaToken as string,
        conf.validatorFunctionName as string,
        logger,
        lambdaClient
      );

      if (!result.isHuman) {
        // Expired/invalid token: tell client to solve captcha again + clear cached token client-side
        if (result.statusCode === 400) {
          logger.warn(`Failed reCAPTCHA validation (reason=${result.reason})`);
          return webUtils.failure(
            403, // or 400; many APIs prefer 403 "forbidden by policy"
            "captcha_failed",
            result.reason === "expired"
              ? "Captcha expired, please try again."
              : "Invalid captcha, please try again.",
            context.awsRequestId,
            event.requestContext.requestId
          );
        }

        // Transient/server error: do NOT blame the user; allow retry later
        logger.error(
          `Captcha verification unavailable (reason=${result.reason})`
        );
        return webUtils.failure(
          503,
          "captcha_unavailable",
          "Captcha verification service is temporarily unavailable. Please try again.",
          context.awsRequestId,
          event.requestContext.requestId
        );
      }

      logger.info("reCAPTCHA validation passed");
    }
    // -------------------------------------------

    await putSubscription(req);

    logger.info("Subscription creation completed successfully");
    return webUtils.success(
      201,
      {},
      context.awsRequestId,
      event.requestContext.requestId
    );
  } catch (err) {
    logger.error("Error creating subscription", err);
    return webUtils.failure(
      500,
      "internal_service_error",
      "An unexpected error occurred",
      context.awsRequestId,
      event.requestContext.requestId
    );
  }
};
