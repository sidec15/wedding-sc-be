// Database entities
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

// Messages
export interface CommentEvent {
  type: "comment-created";
  photoId: string;
  commentId: string;
}
