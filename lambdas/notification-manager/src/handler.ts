import { CommentEvent, CommentSubscribion, ILogger, Logger } from "@wedding/common";
import { Context, SNSEvent } from "aws-lambda";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";


interface EmailNotificationMessage {
  type: "contact-us" | "comment-notification";
  to: string[];
  subject: string;
  text?: string;
  html?: string;
}

const logger: ILogger = new Logger();
const ddb = new DynamoDBClient({});
const TABLE_NAME = "photo_subscriptions";

const snsClient = new SNSClient({ region: process.env.AWS_REGION });

export const handler = async (
  event: SNSEvent,
  context: Context
): Promise<void> => {
  for (const record of event.Records) {
    try {
      const event = JSON.parse(record.Sns.Message) as CommentEvent;
      await handleEvent(event);
    } catch (error) {
      logger.error("❌ Failed to send email:", error);
    }
  }
};

const handleEvent = async (event: CommentEvent) => {
  const type = event.type;

  if (type === "comment-created") {
    await handleCommentCreated(event);
  } else {
    logger.info(`ℹ️ Ignoring unsupported event type: ${type}`);
  }

  logger.info(`✅ Event of type ${type} handled successfully`);
};

const handleCommentCreated = async (event: CommentEvent) => {
  const { photoId, commentId } = event;

  // 1) Load subscribers for the photo
  const subscribers = await listSubscriptions(photoId);
  if (subscribers.length === 0) {
    logger.info(`No subscribers for photo ${photoId}. Skipping notifications.`);
    return;
  }

  // 2) Build base email content
  const link = permalink ?? `https://your-domain.example/photos/${photoId}#${commentId}`;
  const subject = `New comment on photo ${photoId}`;
  const baseText = `${authorName} added a comment:\n\n${contentPreview ?? ""}\n\nOpen: ${link}\n`;
  const baseHtml = `
    <p><strong>${escapeHtml(authorName)}</strong> added a comment:</p>
    <blockquote>${escapeHtml(contentPreview ?? "")}</blockquote>
    <p><a href="${link}">Open photo & thread</a></p>
  `;

  // 3) Publish one email notification per (active) subscriber
  let published = 0;
  for (const s of subscribers) {

    const text = appendUnsubText(baseText, s);
    const html = appendUnsubHtml(baseHtml, s);

    const message: EmailNotificationMessage = {
      type: "comment-notification",
      to: [s.email],
      subject,
      text,
      html,
    };

    const topicArn = process.env.EMAIL_SNS_TOPIC_ARN;

    await snsClient.send(new PublishCommand({
      TopicArn: topicArn,
      Message: JSON.stringify(message),
    }));

    published++;
  }

  logger.info(`📨 Published ${published} email notifications for photo ${photoId}`);
};

export async function listSubscriptions(photoId: string): Promise<CommentSubscribion[]> {
  const res = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: "photoId = :p",
    ExpressionAttributeValues: { ":p": { S: photoId } },
    ProjectionExpression: "commentId, photoId, email",
  }));

  return (res.Items ?? []).map(item => ({
    commentId: item.commentId.S!,
    photoId: item.photoId.S!,
    email: item.email.S!,
  }));
}
