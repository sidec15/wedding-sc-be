// Database entities ---------------------------------
export interface Comment {
  photoId: string;
  commentId: string;
  createdAt: string;
  authorName: string;
  content: string;
}

export interface CommentSubscribion {
  commentId: string;
  photoId: string;
  email: string;
}

// Messages --------------------------------------
export interface CommentEvent {
  type: "comment-created";
  photoId: string;
  commentId: string;
}

export interface EmailNotificationMessage {
  type: "contact-us" | "comment-notification";
  to: string[];
  subject: string;
  text?: string;
  html?: string;
}

// DTOs ---------------------------------------------
export interface PaginatedResult<T> {
  elements: T[];
  cursor?: string; // opaque next-page token (base64-encoded LEK)
  hasNext: boolean;
  totalElements: number; // full count for this photoId
  totalPagesCount: number;
}
