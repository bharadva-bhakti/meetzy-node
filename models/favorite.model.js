const mongoose = require('mongoose');
const { Schema } = mongoose;

const FavoriteSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    target_id: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    target_type: {
      type: String,
      enum: ['user', 'group', 'announcement'],
      required: true,
    },
  },
  {
    collection: 'favorites',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

FavoriteSchema.index({ user_id: 1, target_type: 1, target_id: 1 }, { unique: true });
FavoriteSchema.index({ user_id: 1 });
FavoriteSchema.index({ target_type: 1, target_id: 1 });
FavoriteSchema.index({ created_at: 1 });

module.exports = mongoose.model('Favorite', FavoriteSchema);