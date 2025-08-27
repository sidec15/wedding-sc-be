import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { ILogger, Logger } from "@wedding/common";
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

const parseAndValidateRequest = (event: any): CreateSubscriptionRequest | null => {
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
    logger.error("Validation failed: Invalid email format", { email: body.email });
    return null;
  }

  logger.info("Request validated successfully", { photoId, email });
  return { email, photoId, recaptchaToken: body.recaptchaToken };
};

// minimal invoker: expects { success: boolean } from captcha-validator
const validateRecaptcha = async (token: string): Promise<boolean> => {
  const fn = conf.validatorFunctionName;
  if (!fn) throw new Error("Missing CAPTCHA_VALIDATOR_FUNCTION_NAME");

  if (logger.isDebugEnabled()) {
    logger.debug(`Invoking captcha validator lambda: ${fn}`);
  }

  const payload = { body: JSON.stringify({ token }) };

  const out = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: fn,
      InvocationType: "RequestResponse",
      Payload: Buffer.from(JSON.stringify(payload)),
    })
  );

  if (out.FunctionError) {
    logger.error(`Captcha validator returned FunctionError: ${out.FunctionError}`);
    return false;
  }

  const text = out.Payload ? new TextDecoder().decode(out.Payload as Uint8Array) : "";
  const res = text ? JSON.parse(text) : {};
  const body = res?.body ? JSON.parse(res.body) : {};

  if (logger.isDebugEnabled()) {
    logger.debug(`Captcha validator response: ${JSON.stringify(res)}`);
  }

  return !!body.success;
};

const putSubscription = async (req: CreateSubscriptionRequest): Promise<void> => {
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
      logger.error("Request validation failed — aborting subscription creation");
      return webUtils.failure(400, "validation_failed", "Invalid or missing input");
    }

    // --- reCAPTCHA (simple boolean contract) ---
    if (conf.use_recaptcha) {
      if (!req.recaptchaToken) {
        logger.warn("Missing reCAPTCHA token");
        return webUtils.failure(400, "missing_recaptcha_token", "Missing reCAPTCHA token");
      }

      logger.info("Validating reCAPTCHA token via captcha-validator lambda");
      const isHuman = await validateRecaptcha(req.recaptchaToken);
      if (!isHuman) {
        logger.warn("Failed reCAPTCHA validation");
        return webUtils.failure(403, "captcha_failed", "Failed reCAPTCHA validation");
      }
      logger.info("reCAPTCHA validation passed");
    }
    // -------------------------------------------

    await putSubscription(req);

    logger.info("Subscription creation completed successfully");
    return webUtils.success(201, {});
  } catch (err) {
    logger.error("Error creating subscription", err);
    return webUtils.failure(500, "internal_service_error", "An unexpected error occurred");
  }
};
