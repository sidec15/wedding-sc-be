import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { ulid } from "ulid";
import { DateTime } from "luxon";
import { Comment, CommentEvent, ILogger, Logger } from "@wedding/common";
import * as webUtils from "@wedding/common/dist/utils/web.utils";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";

const conf = {
  db: {
    region: process.env.DB_AWS_REGION || "eu-west-1",
    tables: {
      comments: process.env.COMMENTS_TABLE,
    },
  },
  authorNameRegex: process.env.AUTHOR_NAME_REGEX,
  contentMaxLength: process.env.CONTENT_MAX_LENGTH,
  sns:{
    topicArn:{
      comments: process.env.COMMENT_SNS_TOPIC_ARN
    }
  }
};

const ddb = new DynamoDBClient({});
const COMMENTS_TABLE = conf.db.tables.comments!;

const logger: ILogger = new Logger();
const snsClient = new SNSClient({ region: conf.db.region });

// ---------- Config from ENV with defaults ----------
const AUTHOR_NAME_REGEX = conf.authorNameRegex
  ? new RegExp(conf.authorNameRegex)
  : /^[a-zA-ZÀ-ÿ' -]+$/;

const CONTENT_MAX_LENGTH = conf.contentMaxLength
  ? parseInt(conf.contentMaxLength, 10)
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

    const result = webUtils.success(201, comment);

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
      "An unexpected error occurred"
    );
  }
};
