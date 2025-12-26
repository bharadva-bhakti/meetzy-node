const mongoose = require('mongoose');
const { Schema } = mongoose;

const UserSchema = new Schema(
  {
    avatar: { 
      type: String, 
      default: null 
    },
    name: { 
      type: String, 
      required: true 
    },
    bio: { 
      type: String, 
      default: 'Hey, I am using meetzy.', 
      required: true 
    },
    email: { 
      type: String, 
      unique: true, 
      sparse: true 
    },
    password: { 
      type: String, 
      default: null 
    },
    country: { 
      type: String, 
      default: null 
    },
    country_code: { 
      type: String, 
      default: null 
    },
    phone: { 
      type: String, 
      default: null 
    },
    role: { 
      type: String, 
      enum: ['super_admin', 'user'], 
      default: 'user' 
    },
    email_verified: { 
      type: Boolean, 
      default: false 
    },
    last_login: { 
      type: Date, 
      default: null 
    },
    is_online: { 
      type: Boolean, 
      default: false 
    },
    last_seen: { 
      type: Date, 
      default: null 
    },
    status: { 
      type: String, 
      enum: ['active', 'deactive'], 
      default: 'active' 
    },
    public_key: { 
      type: String, 
      default: null 
    },
    private_key: { 
      type: String, 
      default: null 
    },

    // Blue tick verification
    stripe_customer_id: { 
      type: String, 
      unique: true, 
      sparse: true 
    },
    is_verified: { 
      type: Boolean, 
      default: false 
    },
    verified_at: { 
      type: Date, 
      default: null 
    },

    deleted_at: { 
      type: Date, 
      default: null 
    },
  },
  {
    collection: 'users',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

UserSchema.index({ email: 1 });
UserSchema.index({ status: 1 });
UserSchema.index({ role: 1 });
UserSchema.index({ last_seen: 1 });
UserSchema.index({ is_online: 1 });
UserSchema.index({ deleted_at: 1 });
UserSchema.index({ created_at: 1 });

module.exports = mongoose.model('User', UserSchema);