import { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2, Context } from "aws-lambda";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { ulid } from "ulid";
import { DateTime } from "luxon";
import { Comment, CommentEvent, ILogger, Logger } from "@wedding/common";
import * as webUtils from "@wedding/common/dist/utils/web.utils";

const conf = {
  db: {
    region: process.env.DB_AWS_REGION || "eu-west-1",
    tables: {
      comments: process.env.COMMENTS_TABLE,
    },
  },
  authorNameRegex: process.env.AUTHOR_NAME_REGEX,
  contentMaxLength: process.env.CONTENT_MAX_LENGTH,
  sns: {
    topicArn: {
      comments: process.env.COMMENT_SNS_TOPIC_ARN,
    },
  },
  use_recaptcha: process.env.USE_RECAPTCHA === "true",
  validatorFunctionName: process.env.CAPTCHA_VALIDATOR_FUNCTION_NAME,
};

const ddb = new DynamoDBClient({});
const COMMENTS_TABLE = conf.db.tables.comments!;

const logger: ILogger = new Logger();
const snsClient = new SNSClient({ region: conf.db.region });
const lambdaClient = new LambdaClient({ region: conf.db.region });

// ---------- Config from ENV with defaults ----------
const AUTHOR_NAME_REGEX = conf.authorNameRegex
  ? new RegExp(conf.authorNameRegex)
  : /^[a-zA-Z0-9' -]+$/;

const CONTENT_MAX_LENGTH = conf.contentMaxLength
  ? parseInt(conf.contentMaxLength, 10)
  : 2000;

// Log configuration at silly level
logger.silly("Validation config loaded", {
  AUTHOR_NAME_REGEX: AUTHOR_NAME_REGEX.toString(),
  CONTENT_MAX_LENGTH,
  USE_RECAPTCHA: conf.use_recaptcha,
  CAPTCHA_VALIDATOR_FUNCTION_NAME: conf.validatorFunctionName,
});

interface CreateCommentRequest {
  photoId: string;
  authorName: string;
  content: string;
  recaptchaToken?: string;
}

// ---------- Validation Helpers ----------
const validateAuthorName = (value: any): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!AUTHOR_NAME_REGEX.test(trimmed)) return null;
  return trimmed;
};

const validateContent = (value: any): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length > CONTENT_MAX_LENGTH) return null;
  return trimmed;
};

// Minimal invoker: expects { success: boolean } from captcha-validator
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
    logger.error(
      `Captcha validator returned FunctionError: ${out.FunctionError}`
    );
    return false;
  }

  const text = out.Payload
    ? new TextDecoder().decode(out.Payload as Uint8Array)
    : "";
  const res = text ? JSON.parse(text) : {};
  const body = res?.body ? JSON.parse(res.body) : {};

  if (logger.isDebugEnabled()) {
    logger.debug(`Captcha validator response: ${JSON.stringify(res)}`);
  }

  return !!body.success;
};

// ---------- Core Logic ----------
const parseAndValidateRequest = (event: any): CreateCommentRequest | null => {
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

  const authorName = validateAuthorName(body.authorName);
  if (!authorName) {
    logger.error("Validation failed: Invalid authorName", {
      providedValue: body.authorName,
    });
    return null;
  }

  const content = validateContent(body.content);
  if (!content) {
    logger.error("Validation failed: Invalid content", {
      providedValue: body.content,
    });
    return null;
  }

  logger.info("Request validated successfully", { photoId });
  return {
    photoId,
    authorName,
    content,
    recaptchaToken: body.recaptchaToken, // may be undefined
  };
};

const putComment = async (req: CreateCommentRequest): Promise<Comment> => {
  const commentId = `c_${ulid()}`;
  const createdAt = DateTime.utc().toISO(); // Luxon timestamp
  const sk = `${createdAt}#${commentId}`;

  logger.info("Storing comment in DynamoDB", {
    table: COMMENTS_TABLE,
    photoId: req.photoId,
    commentId,
    createdAt,
  });

  await ddb.send(
    new PutItemCommand({
      TableName: COMMENTS_TABLE,
      Item: {
        photoId: { S: req.photoId },
        "createdAt#commentId": { S: sk },
        commentId: { S: commentId },
        createdAt: { S: createdAt },
        authorName: { S: req.authorName },
        content: { S: req.content },
      },
      ConditionExpression:
        "attribute_not_exists(photoId) AND attribute_not_exists(#sk)",
      ExpressionAttributeNames: {
        "#sk": "createdAt#commentId",
      },
    })
  );

  logger.info("Comment successfully stored", {
    photoId: req.photoId,
    commentId,
  });

  return {
    photoId: req.photoId,
    commentId,
    createdAt,
    authorName: req.authorName,
    content: req.content,
  };
};

// Publish to SNS topic
const publishSnsEvent = async (e: CommentEvent) => {
  try {
    const topicArn = conf.sns.topicArn.comments;

    const publishCommand = new PublishCommand({
      TopicArn: topicArn,
      Message: JSON.stringify(e),
    });
    if (logger.isDebugEnabled()) {
      logger.debug(
        `Publishing SNS event with command: ${JSON.stringify(publishCommand)}`
      );
    }

    await snsClient.send(publishCommand);

    logger.info(`Correctly published event on topic: ${topicArn}`);
  } catch (error) {
    logger.error(`Error publishing SNS event`, error);
  }
};

// ---------- Lambda Handler ----------
export const handler: APIGatewayProxyHandlerV2 = async (
  event: APIGatewayProxyEventV2,
  context: Context
) => {
  logger.info("Received request to create comment", {
    pathParameters: event.pathParameters,
    requestId: event.requestContext?.requestId,
  });

  try {
    const req = parseAndValidateRequest(event);
    if (!req) {
      logger.error("Request validation failed — aborting comment creation");
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
      const isHuman = await validateRecaptcha(req.recaptchaToken);
      if (!isHuman) {
        logger.warn("Failed reCAPTCHA validation");
        return webUtils.failure(
          403,
          "captcha_failed",
          "Failed reCAPTCHA validation",
          context.awsRequestId,
          event.requestContext.requestId
        );
      }
      logger.info("reCAPTCHA validation passed");
    }
    // -------------------------------------------

    const comment = await putComment(req);

    logger.info("Comment creation completed successfully", {
      photoId: comment.photoId,
      commentId: comment.commentId,
    });

    const result = webUtils.success(
      201,
      comment,
      context.awsRequestId,
      event.requestContext.requestId
    );

    await publishSnsEvent({
      type: "comment-created",
      photoId: comment.photoId,
      commentId: comment.commentId,
    });

    return result;
  } catch (err) {
    logger.error("Error creating comment", err);
    return webUtils.failure(
      500,
      "internal_service_error",
      "An unexpected error occurred",
      context.awsRequestId,
      event.requestContext.requestId
    );
  }
};
