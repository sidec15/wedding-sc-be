import {
  Comment,
  CommentEvent,
  CommentSubscribion,
  dateTimeUtils,
  ILogger,
  Logger,
} from "@wedding/common";
import { Context, SNSEvent } from "aws-lambda";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { DateTime } from "luxon";

interface EmailNotificationMessage {
  type: "contact-us" | "comment-notification";
  to: string[];
  subject: string;
  text?: string;
  html?: string;
}

const conf = {
  awsRegion: process.env.MY_AWS_REGION || "eu-west-1",
  emailTopicArn: process.env.EMAIL_SNS_TOPIC_ARN,
  tables: {
    subscriptions:
      process.env.TABLE_SUBSCRIPTIONS_NAME || "photo_subscriptions",
    comments: process.env.TABLE_COMMENTS_NAME || "photo_comments",
  },
  apiDomain:
    process.env.API_DOMAIN || "https://matrimonio.api.chiaraesimone.it",
  ownerEmails: (process.env.OWNER_EMAILS || "").split(","),
};

const logger: ILogger = new Logger();
const ddb = new DynamoDBClient({});

const snsClient = new SNSClient({ region: conf.awsRegion });

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
  const subscriptions = await listSubscriptions(photoId);
  if (subscriptions.length === 0) {
    logger.debug(`No subscribers for photo ${photoId}.`);
  }

  // 2) Add owner emails
  const ownerEmails = conf.ownerEmails;
  subscriptions.push(
    ...ownerEmails.map((e) => ({
      email: e,
      photoId,
    }))
  );

  // 3) retrieve comment created
  const comment = await getComment(commentId);

  if (!comment) {
    logger.info(`Comment with id ${commentId} not found.`);
    return;
  }

  // 4) Publish one email notification per (active) subscriber
  let published = 0;
  for (const s of subscriptions) {
    const subject = "Matrimonio Chiara & Simone - Nuovo commento";
    const unsubscribeLink = `${conf.apiDomain}/photos/${photoId}/subscriptions/${encodeURIComponent(s.email)}`;
    const photoLink = `${conf.apiDomain}/our-story?${encodeURIComponent(s.photoId)}`;
    const dt = DateTime.fromISO(comment.createdAt, { zone: "utc" });
    const createdAt = dateTimeUtils.formatItalianDateTime(dt as DateTime<true>);
    const text = createPhotoCommentNotificationText(
      comment.authorName,
      comment.content,
      createdAt,
      unsubscribeLink,
      photoLink
    );
    const html = createPhotoCommentNotificationHtml(
      comment.authorName,
      comment.content,
      createdAt,
      unsubscribeLink,
      photoLink
    );
    const message: EmailNotificationMessage = {
      type: "comment-notification",
      to: [s.email],
      subject,
      text,
      html,
    };

    const topicArn = conf.emailTopicArn;

    await snsClient.send(
      new PublishCommand({
        TopicArn: topicArn,
        Message: JSON.stringify(message),
      })
    );

    published++;
  }

  logger.info(
    `📨 Published ${published} email notifications for photo ${photoId}`
  );
};

const listSubscriptions = async (
  photoId: string
): Promise<CommentSubscribion[]> => {
  const res = await ddb.send(
    new QueryCommand({
      TableName: conf.tables.subscriptions,
      KeyConditionExpression: "photoId = :p",
      ExpressionAttributeValues: { ":p": { S: photoId } },
      ProjectionExpression: "photoId, email",
    })
  );

  return (res.Items ?? []).map((item) => ({
    photoId: item.photoId.S!,
    email: item.email.S!,
  }));
};

const getComment = async (commentId: string) => {
  const res = await ddb.send(
    new QueryCommand({
      TableName: conf.tables.comments,
      IndexName: "commentId-index",
      KeyConditionExpression: "commentId = :c",
      ExpressionAttributeValues: { ":c": { S: commentId } },
      ProjectionExpression:
        "photoId, commentId, authorName, content, createdAt",
    })
  );

  if (!res.Items?.length) return null;

  const item = res.Items[0];
  return {
    commentId: item.commentId.S!,
    photoId: item.photoId.S!,
    authorName: item.authorName.S!,
    content: item.content.S!,
    createdAt: item.createdAt.S!,
  } as Comment;
};

const createPhotoCommentNotificationHtml = (
  authorName: string,
  content: string,
  createdAt: string,
  unsubscribeLink: string,
  photoLink: string
) => {
  return `
  <div style="font-family: 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #555; max-width: 600px; margin: 0 auto;">
    <div style="background-color: #fdf2f5; padding: 20px; border-radius: 8px; border: 1px solid #f5d6e0;">
      <h2 style="color: #d67a8a; margin-bottom: 15px; text-align: center; font-weight: 300;">
        📸 Nuovo commento su una foto che segui
      </h2>
      
      <div style="background: white; padding: 20px; border-radius: 5px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
        <p style="margin-bottom: 20px;">Ciao,<br>è stato pubblicato un nuovo commento su una foto a cui sei iscritto.</p>
        
        <table cellpadding="10" cellspacing="0" border="0" style="border-collapse: collapse; width: 100%;">
          <tr>
            <td style="font-weight: bold; width: 120px; color: #d67a8a;">Autore</td>
            <td style="border-bottom: 1px dashed #f0c8d2;">${authorName}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; color: #d67a8a; vertical-align: top;">Commento</td>
            <td style="border-bottom: 1px dashed #f0c8d2; white-space: pre-line; padding-bottom: 15px;">
              ${content}
            </td>
          </tr>
          <tr>
            <td style="font-weight: bold; color: #d67a8a;">Data</td>
            <td style="border-bottom: 1px dashed #f0c8d2;">${createdAt}</td>
          </tr>
        </table>

        <div style="text-align: center; margin-top: 25px;">
          <a href="${photoLink}" style="background-color: #d67a8a; color: #fff; padding: 12px 20px; border-radius: 5px; text-decoration: none; font-weight: bold; display: inline-block;">
            🔗 Vai alla foto
          </a>
        </div>
      </div>
      
      <p style="text-align: center; margin-top: 25px; font-size: 13px; color: #999;">
        Ricevi questa email perché ti sei iscritto per ricevere notifiche sui nuovi commenti di questa foto.<br>
        Se non vuoi più riceverle, puoi <a href="${unsubscribeLink}" style="color: #d67a8a; text-decoration: none;">disiscriverti qui</a>.
      </p>
    </div>
  </div>
  `;
};

const createPhotoCommentNotificationText = (
  authorName: string,
  content: string,
  createdAt: string,
  unsubscribeLink: string,
  photoLink: string
) => {
  return `
Ciao,

È stato pubblicato un nuovo commento su una foto a cui sei iscritto.

Autore: ${authorName}
Commento:
${content}
Data: ${createdAt}

Puoi vedere la foto qui: ${photoLink}

Ricevi questa email perché ti sei iscritto per ricevere notifiche sui nuovi commenti di questa foto.
Se non vuoi più riceverle, puoi disiscriverti qui: ${unsubscribeLink}
`.trim();
};
