import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { ILogger, Logger } from "@wedding/common";

const conf = {
  db: {
    region: process.env.AWS_REGION ?? "eu-west-1",
    tables: {
      comments: process.env.COMMENTS_TABLE ?? "photo_comments",
    },
  },
  pagination: {
    defaultPageSize: parseInt(process.env.DEFAULT_PAGE_SIZE ?? "20", 10),
    maxPageSize: parseInt(process.env.MAX_PAGE_SIZE ?? "100", 10),
  },
  defaults: {
    order: (process.env.DEFAULT_ORDER ?? "desc").toLowerCase() as "asc" | "desc",
  },
};

const logger: ILogger = new Logger();

// Cold-start logs
logger.silly("Config loaded", conf);

const ddb = new DynamoDBClient({ region: conf.db.region });

type Order = "asc" | "desc";

interface Comment {
  photoId: string;
  commentId: string;
  createdAt: string;
  authorName: string;
  content: string;
}

interface ListResponse {
  elements: Comment[];
  hasNext: boolean;
  pageIndex: number;
  totalPagesCount: number;
  totalElements: number;
}

// ---------- Response helpers ----------
const success = (statusCode: number, body: any) => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const failure = (statusCode: number, errorCode: string, message: string) =>
  success(statusCode, { errorCode, message });

// ---------- Parse & validate ----------
const parseOrder = (raw?: string): Order =>
  (raw?.toLowerCase() === "asc" ? "asc" : "desc");

const parseIntOr = (raw: any, fallback: number) => {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
};

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
  const pageIndex = Math.max(parseIntOr(qs.pageIndex, 1), 1);

  let pageSize = parseIntOr(qs.pageSize, conf.pagination.defaultPageSize);
  if (pageSize < 1) pageSize = 1;
  if (pageSize > conf.pagination.maxPageSize) pageSize = conf.pagination.maxPageSize;

  const order = parseOrder(qs.order ?? conf.defaults.order);

  logger.info("List comments request validated", { photoId, pageIndex, pageSize, order });
  return { photoId, pageIndex, pageSize, order };
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

/**
 * Sequentially hops pages using ExclusiveStartKey to emulate OFFSET/LIMIT.
 */
const queryPage = async (
  tableName: string,
  photoId: string,
  pageIndex: number,
  pageSize: number,
  order: Order
) => {
  let lastKey: any = undefined;
  let pageItems: any[] = [];

  for (let i = 1; i <= pageIndex; i++) {
    const res = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "photoId = :pid",
        ExpressionAttributeValues: { ":pid": { S: photoId } },
        Limit: pageSize,
        ExclusiveStartKey: lastKey,
        ScanIndexForward: order === "asc", // true=ASC, false=DESC
      })
    );

    pageItems = res.Items ?? [];
    lastKey = res.LastEvaluatedKey;

    if ((!lastKey || (res.Count ?? 0) < pageSize) && i < pageIndex) {
      // Ran out before requested page
      pageItems = [];
      lastKey = undefined;
      break;
    }
  }

  return { pageItems, hasNext: !!lastKey };
};

const countAll = async (tableName: string, photoId: string): Promise<number> => {
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
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  logger.info("Received request to list comments", {
    pathParameters: event.pathParameters,
    queryStringParameters: event.queryStringParameters,
    requestId: event.requestContext?.requestId,
  });

  try {
    const req = parseAndValidateRequest(event);
    if (!req) {
      logger.error("Request validation failed — aborting list");
      return failure(400, "validation_failed", "Invalid or missing input");
    }

    const { photoId, pageIndex, pageSize, order } = req;
    const tableName = conf.db.tables.comments!;

    const { pageItems, hasNext } = await queryPage(tableName, photoId, pageIndex, pageSize, order);
    const elements = mapItemsToComments(pageItems);

    const totalElements = await countAll(tableName, photoId);
    const totalPagesCount = totalElements === 0 ? 0 : Math.ceil(totalElements / pageSize);

    const response: ListResponse = {
      elements,
      hasNext,
      pageIndex,
      totalPagesCount,
      totalElements,
    };

    logger.info("List comments completed", {
      photoId,
      pageIndex,
      pageSize,
      order,
      elementsCount: elements.length,
      totalElements,
      totalPagesCount,
      hasNext,
    });

    return success(200, response);
  } catch (err) {
    logger.error("Error listing comments", err);
    return failure(500, "internal_service_error", "An unexpected error occurred");
  }
};
