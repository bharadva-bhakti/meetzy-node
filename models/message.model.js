const mongoose = require('mongoose');
const { Schema } = mongoose;

const MessageSchema = new Schema(
  {
    sender_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    group_id: {
      type: Schema.Types.ObjectId,
      ref: 'Group',
      default: null,
    },
    recipient_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    parent_id: {
      type: Schema.Types.ObjectId,
      ref: 'Message',
      default: null,
    },
    content: { 
      type: String, 
      default: null 
    },
    message_type: {
      type: String,
      enum: [
        'text', 'link', 'image', 'sticker', 'file', 'video', 'poll',
        'form', 'system', 'call', 'document', 'audio', 'location', 'announcement'
      ],
      default: 'text',
    },
    file_url: { 
      type: String, 
      default: null 
    },
    file_type: { 
      type: String, 
      default: null 
    },
    mentions: { 
      type: [Schema.Types.ObjectId], 
      ref: 'User', 
      default: null 
    },
    has_unread_mentions: { type: Boolean, 
      default: false
      , required: true },
    metadata: { type: Object, 
      default: null 
    },
    is_encrypted: { type: Boolean, 
      default: false
      , required: true },
    deleted_at: { type: Date, 
      default: null 
    },
  },
  {
    collection: 'messages',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

MessageSchema.index({ group_id: 1, created_at: -1 });
MessageSchema.index({ recipient_id: 1, created_at: -1 });
MessageSchema.index({ parent_id: 1 });
MessageSchema.index({ sender_id: 1 });
MessageSchema.index({ message_type: 1 });
MessageSchema.index({ sender_id: 1, recipient_id: 1 });
MessageSchema.index({ deleted_at: 1 });
MessageSchema.index({ created_at: -1 });
MessageSchema.index({ has_unread_mentions: 1 });

module.exports = mongoose.model('Message', MessageSchema);