import { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2, Context } from "aws-lambda";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import {
  Comment,
  dbUtils,
  webUtils,
  ILogger,
  Logger,
  PaginatedResult,
} from "@wedding/common";

const conf = {
  db: {
    region: process.env.AWS_REGION ?? "eu-west-1",
    tables: {
      comments: process.env.COMMENTS_TABLE ?? "photo_comments",
    },
  },
  pagination: {
    defaultLimit: parseInt(process.env.DEFAULT_PAGE_SIZE ?? "20", 10),
    defaultOrder: (process.env.DEFAULT_ORDER ?? "desc").toLowerCase() as
      | "asc"
      | "desc",
  },
};

const logger: ILogger = new Logger();
logger.silly("Config loaded", conf);

const ddb = new DynamoDBClient({ region: conf.db.region });

type Order = "asc" | "desc";

// ---------- Parse & validate ----------
const parseOrder = (raw?: string): Order =>
  raw?.toLowerCase() === "asc" ? "asc" : "desc";

const parseAndValidateRequest = (event: any) => {
  logger.debug("Parsing and validating request");

  if (!conf.db.tables.comments) {
    logger.error("Configuration error: COMMENTS_TABLE is not set");
    return null;
  }

  const photoId = event.pathParameters?.photoId;
  if (!photoId) {
    logger.error("Validation failed: Missing photoId in path parameters");
    return null;
  }

  const qs = event.queryStringParameters ?? {};
  let limit = parseInt(qs.limit ?? "", 10);
  if (!Number.isFinite(limit) || limit <= 0)
    limit = conf.pagination.defaultLimit;
  if (limit > 1000) limit = 1000;

  const order = parseOrder(qs.order ?? conf.pagination.defaultOrder);
  const cursor =
    typeof qs.cursor === "string" && qs.cursor.length > 0
      ? qs.cursor
      : undefined;
  const exclusiveStartKey = dbUtils.decodeCursor(cursor);

  logger.debug("List comments request validated", {
    photoId,
    limit,
    order,
    hasCursor: !!cursor,
  });
  return { photoId, limit, order, exclusiveStartKey };
};

// ---------- DDB helpers ----------
const mapItemsToComments = (items: any[]): Comment[] =>
  (items ?? []).map((i) => {
    const obj = unmarshall(i);
    return {
      photoId: String(obj.photoId),
      commentId: String(obj.commentId),
      createdAt: String(obj.createdAt),
      authorName: String(obj.authorName),
      content: String(obj.content),
    };
  });

/** Counts all comments for a photoId (handles pagination of COUNT). */
const countAll = async (
  tableName: string,
  photoId: string
): Promise<number> => {
  let total = 0;
  let lastKey: any = undefined;

  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "photoId = :pid",
        ExpressionAttributeValues: { ":pid": { S: photoId } },
        Select: "COUNT",
        ExclusiveStartKey: lastKey,
      })
    );
    total += res.Count ?? 0;
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  return total;
};

// ---------- Handler ----------
export const handler: APIGatewayProxyHandlerV2 = async (
  event: APIGatewayProxyEventV2,
  context: Context
) => {
  logger.info("Received request to list comments", {
    pathParameters: event.pathParameters,
    queryStringParameters: event.queryStringParameters,
    requestId: event.requestContext?.requestId,
  });

  try {
    const req = parseAndValidateRequest(event);
    if (!req) {
      logger.error("Request validation failed — aborting list");
      return webUtils.failure(
        400,
        "validation_failed",
        "Invalid or missing input",
        context.awsRequestId,
        event.requestContext.requestId
      );
    }

    const { photoId, limit, order, exclusiveStartKey } = req;
    const tableName = conf.db.tables.comments!;

    // Page fetch using cursor → ExclusiveStartKey
    const queryRes = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "photoId = :pid",
        ExpressionAttributeValues: { ":pid": { S: photoId } },
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
        ScanIndexForward: order === "asc", // true=ASC, false=DESC
      })
    );

    const elements = mapItemsToComments(queryRes.Items ?? []);
    const nextCursor = dbUtils.encodeCursor(queryRes.LastEvaluatedKey);
    const hasNext = !!queryRes.LastEvaluatedKey;

    // Totals for UI (optional but requested)
    const totalElements = await countAll(tableName, photoId);
    const totalPagesCount =
      totalElements === 0 ? 0 : Math.ceil(totalElements / limit);

    const response: PaginatedResult<Comment> = {
      elements,
      cursor: nextCursor, // opaque token to pass back as ?cursor=...
      hasNext,
      totalElements,
      totalPagesCount,
    };

    logger.info("List comments completed", {
      photoId,
      limit,
      order,
      elementsCount: elements.length,
      totalElements,
      totalPagesCount,
      hasNext,
      returnedCursor: !!nextCursor,
    });

    return webUtils.success(
      200,
      response,
      context.awsRequestId,
      event.requestContext.requestId
    );
  } catch (err) {
    logger.error("Error listing comments", err);
    return webUtils.failure(
      500,
      "internal_service_error",
      "An unexpected error occurred",
      context.awsRequestId,
      event.requestContext.requestId
    );
  }
};
