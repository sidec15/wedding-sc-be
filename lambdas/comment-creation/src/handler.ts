import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { ulid } from "ulid";
import { DateTime } from "luxon";
import { ILogger, Logger } from "@wedding/common";
import * as webUtils from "@wedding/common/dist/utils/web.utils";

// todo_here: create lambda to subscribe for notification events

const ddb = new DynamoDBClient({});
const COMMENTS_TABLE = process.env.COMMENTS_TABLE!;

const logger: ILogger = new Logger();

// ---------- Config from ENV with defaults ----------
const AUTHOR_NAME_REGEX = process.env.AUTHOR_NAME_REGEX
  ? new RegExp(process.env.AUTHOR_NAME_REGEX)
  : /^[a-zA-ZÀ-ÿ' -]+$/;

const CONTENT_MAX_LENGTH = process.env.CONTENT_MAX_LENGTH
  ? parseInt(process.env.CONTENT_MAX_LENGTH, 10)
  : 2000;

// Log configuration at silly level
logger.silly("Validation config loaded", {
  AUTHOR_NAME_REGEX: AUTHOR_NAME_REGEX.toString(),
  CONTENT_MAX_LENGTH,
});

interface CreateCommentRequest {
  photoId: string;
  authorName: string;
  content: string;
}

interface Comment {
  photoId: string;
  commentId: string;
  createdAt: string;
  authorName: string;
  content: string;
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
  return { photoId, authorName, content };
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

// ---------- Lambda Handler ----------
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
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
        "Invalid or missing input"
      );
    }

    const comment = await putComment(req);

    logger.info("Comment creation completed successfully", {
      photoId: comment.photoId,
      commentId: comment.commentId,
    });

    return webUtils.success(201, comment);
  } catch (err) {
    logger.error("Error creating comment", err);
    return webUtils.failure(
      500,
      "internal_service_error",
      "An unexpected error occurred"
    );
  }
};
